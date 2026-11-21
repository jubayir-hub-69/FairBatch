use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use fairbatch_backend::{
    api::{build_router, build_shared_engine},
    clearing::{FillStatus, OrderSide, SubmissionType},
    state::{
        BatchPhase, ClaimBatchResponse, CommitOrderResponse, ComputeHashResponse,
        SettleBatchResponse, SignDemoIntentResponse, StateResponse, StatelessCompareResponse,
    },
};
use http_body_util::BodyExt;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tower::ServiceExt;

fn test_app() -> Router {
    build_router(build_shared_engine())
}

async fn send_json<T: DeserializeOwned>(
    app: &Router,
    method: &str,
    uri: &str,
    payload: Option<Value>,
) -> (StatusCode, T) {
    let builder = Request::builder().method(method).uri(uri);
    let req = match payload {
        Some(val) => builder
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&val).unwrap()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let parsed: T = serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        panic!(
            "Failed to deserialize response from {method} {uri} (status={status}): {e}\nBody: {}",
            String::from_utf8_lossy(&bytes)
        )
    });
    (status, parsed)
}

#[tokio::test]
async fn test_health_and_sepolia_contracts_from_global_config() {
    let app = test_app();

    let (status, health): (_, Value) = send_json(&app, "GET", "/api/health", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(health["status"], "ok");
    assert_eq!(health["chain_id"], 11155111);
    assert!(health["contracts"]["faucet"].is_string());

    let (status, meta): (_, Value) = send_json(&app, "GET", "/api/contracts", None).await;
    assert_eq!(status, StatusCode::OK);
    let networks = meta["supported_networks"].as_array().unwrap();
    assert_eq!(networks.len(), 1);
    assert_eq!(networks[0]["chain_id"], 11155111);

    // Runtime contract/fork switching endpoint must not be mounted.
    let req = Request::builder()
        .method("POST")
        .uri("/api/config/contracts")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_preset_five_sellers_with_sandwich_bot_zero_mev_proof() {
    let app = test_app();

    let (status, state): (_, StateResponse) = send_json(
        &app,
        "POST",
        "/api/presets/load",
        Some(json!({
            "preset": "five_sellers",
            "include_sandwich_bot": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(state.orders.len(), 7);
    assert!(state.orders[0].is_attacker);
    assert!(state.orders[6].is_attacker);

    let (status, settled): (_, SettleBatchResponse) =
        send_json(&app, "POST", "/api/batch/settle", None).await;
    assert_eq!(status, StatusCode::OK);

    let s = &settled.settlement;
    assert!((s.clearing_price - 2727.272727).abs() < 1e-3);
    assert!(s.k_invariant_growth > 68_000.0);
    assert!(s.comparison.amm_sandwich_profit_quote > 1_000.0);
    assert_eq!(s.comparison.fairbatch_sandwich_profit_quote, 0.0);
    assert!(s.comparison.user_value_saved_quote > 500.0);

    // Every non-attacker seller gets the identical uniform effective price
    let victim_fills: Vec<_> = s.fills.iter().filter(|f| !f.is_attacker).collect();
    assert_eq!(victim_fills.len(), 5);
    for vf in &victim_fills {
        assert_eq!(vf.status, FillStatus::Filled);
        assert!((vf.payout_out - victim_fills[0].payout_out).abs() < 1e-9);
    }

    // State advanced to Batch #2 cleanly
    assert_eq!(settled.state.batch_id, 2);
    assert_eq!(settled.state.phase, BatchPhase::Open);
    assert!(settled.state.orders.is_empty());
    assert_eq!(settled.state.settled_history.len(), 1);
    assert_eq!(settled.state.claimable.len(), 7);
}

#[tokio::test]
async fn test_preset_cow_balanced_and_marginal_pro_rata() {
    let app = test_app();

    // 1. Balanced CoW -> p* = 3000.0, 100% CoW match, 0 pool reserve change
    let (_, _): (_, StateResponse) = send_json(
        &app,
        "POST",
        "/api/presets/load",
        Some(json!({
            "preset": "cow_balanced",
            "include_sandwich_bot": false
        })),
    )
    .await;

    let (status, cow_res): (_, SettleBatchResponse) =
        send_json(&app, "POST", "/api/batch/settle", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!((cow_res.settlement.clearing_price - 3000.0).abs() < 1e-6);
    assert!((cow_res.settlement.cow_matched_base - 5.0).abs() < 1e-6);
    assert!((cow_res.settlement.cow_matched_quote - 15_000.0).abs() < 1e-6);
    assert!((cow_res.settlement.cow_ratio_pct - 100.0).abs() < 1e-6);
    assert_eq!(cow_res.settlement.reserves_after.rx, 100.0);
    assert_eq!(cow_res.settlement.reserves_after.ry, 300_000.0);

    // 2. Marginal Pro-Rata -> p* pinned at 2800.0, Filled + PartialFill + OutOfMoneyRefund
    let (_, _): (_, StateResponse) = send_json(
        &app,
        "POST",
        "/api/presets/load",
        Some(json!({
            "preset": "marginal_pro_rata",
            "include_sandwich_bot": false
        })),
    )
    .await;

    let (status, marg_res): (_, SettleBatchResponse) =
        send_json(&app, "POST", "/api/batch/settle", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!((marg_res.settlement.clearing_price - 2800.0).abs() < 1e-6);

    let statuses: Vec<FillStatus> = marg_res.settlement.fills.iter().map(|f| f.status).collect();
    assert_eq!(
        statuses,
        vec![
            FillStatus::Filled,
            FillStatus::PartialFill,
            FillStatus::PartialFill,
            FillStatus::OutOfMoneyRefund,
            FillStatus::Filled,
        ]
    );
}

#[tokio::test]
async fn test_commit_reveal_flow_bad_salt_and_bond_slashing() {
    let app = test_app();
    let (_, init_state): (_, StateResponse) = send_json(&app, "GET", "/api/state", None).await;
    let alice = &init_state.demo_wallets[0].address;
    let bob = &init_state.demo_wallets[1].address;

    let (_, alice_hash): (_, ComputeHashResponse) = send_json(
        &app,
        "POST",
        "/api/orders/compute-hash",
        Some(json!({
            "trader": alice,
            "batch_id": 1,
            "side": "SellBase",
            "amount_in": 2.0,
            "limit_price": 2500.0,
            "salt": "0xdeadbeef1234"
        })),
    )
    .await;

    let (_, bob_hash): (_, ComputeHashResponse) = send_json(
        &app,
        "POST",
        "/api/orders/compute-hash",
        Some(json!({
            "trader": bob,
            "batch_id": 1,
            "side": "SellBase",
            "amount_in": 3.0,
            "limit_price": 2500.0,
            "salt": "0xcafebabe5678"
        })),
    )
    .await;

    let (status, c1): (_, CommitOrderResponse) = send_json(
        &app,
        "POST",
        "/api/orders/commit",
        Some(json!({
            "trader": alice,
            "commitment_hash": alice_hash.commitment_hash,
            "bond_eth": 0.05
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(c1.commit_id, 1);

    let (status, c2): (_, CommitOrderResponse) = send_json(
        &app,
        "POST",
        "/api/orders/commit",
        Some(json!({
            "trader": bob,
            "commitment_hash": bob_hash.commitment_hash,
            "bond_eth": 0.05
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(c2.commit_id, 2);

    // Reveal during Open phase must fail
    let (status, _): (_, Value) = send_json(
        &app,
        "POST",
        "/api/orders/reveal",
        Some(json!({
            "commit_id": 1,
            "trader": alice,
            "side": "SellBase",
            "amount_in": 2.0,
            "limit_price": 2500.0,
            "salt": "0xdeadbeef1234"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Advance Open -> Reveal
    let (status, rev_state): (_, StateResponse) =
        send_json(&app, "POST", "/api/batch/advance", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(rev_state.phase, BatchPhase::Reveal);

    // Wrong salt must fail
    let (status, _): (_, Value) = send_json(
        &app,
        "POST",
        "/api/orders/reveal",
        Some(json!({
            "commit_id": 1,
            "trader": alice,
            "side": "SellBase",
            "amount_in": 2.0,
            "limit_price": 2500.0,
            "salt": "0xwrong0000"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Correct reveal for Alice succeeds
    let (status, revealed_state): (_, StateResponse) = send_json(
        &app,
        "POST",
        "/api/orders/reveal",
        Some(json!({
            "commit_id": 1,
            "trader": alice,
            "side": "SellBase",
            "amount_in": 2.0,
            "limit_price": 2500.0,
            "salt": "0xdeadbeef1234"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(revealed_state.orders.len(), 1);
    assert_eq!(
        revealed_state.orders[0].submission_type,
        SubmissionType::CommitReveal
    );

    // Leave Bob's commitment unrevealed and settle -> Bob's bond is slashed!
    let (status, settled): (_, SettleBatchResponse) =
        send_json(&app, "POST", "/api/batch/settle", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(settled.settlement.slashed_bonds_count, 1);
    assert!(settled.state.commitments[0].revealed);
    assert!(!settled.state.commitments[0].slashed);
    assert!(!settled.state.commitments[1].revealed);
    assert!(settled.state.commitments[1].slashed);
}

#[tokio::test]
async fn test_eip712_intent_signing_recovery_replay_expiry_and_claims() {
    let app = test_app();

    let (status, signed): (_, SignDemoIntentResponse) = send_json(
        &app,
        "POST",
        "/api/orders/sign-demo-intent",
        Some(json!({
            "demo_account_index": 2,
            "side": "BuyBase",
            "amount_in": 6000.0,
            "limit_price": 3200.0,
            "batch_id": 1
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(signed.nonce, 0);

    // Tampered amount must fail cryptographic recovery check
    let (status, _): (_, Value) = send_json(
        &app,
        "POST",
        "/api/orders/intent",
        Some(json!({
            "trader": signed.trader,
            "side": "BuyBase",
            "amount_in": 6001.0,
            "limit_price": 3200.0,
            "batch_id": signed.batch_id,
            "nonce": signed.nonce,
            "deadline": signed.deadline,
            "signature": signed.signature
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Valid EIP-712 intent succeeds
    let (status, st_after): (_, StateResponse) = send_json(
        &app,
        "POST",
        "/api/orders/intent",
        Some(json!({
            "trader": signed.trader,
            "side": "BuyBase",
            "amount_in": 6000.0,
            "limit_price": 3200.0,
            "batch_id": signed.batch_id,
            "nonce": signed.nonce,
            "deadline": signed.deadline,
            "signature": signed.signature
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(st_after.orders.len(), 1);
    assert_eq!(
        st_after.orders[0].submission_type,
        SubmissionType::Eip712Intent
    );

    // Replay of identical signature (nonce=0) must fail
    let (status, _): (_, Value) = send_json(
        &app,
        "POST",
        "/api/orders/intent",
        Some(json!({
            "trader": signed.trader,
            "side": "BuyBase",
            "amount_in": 6000.0,
            "limit_price": 3200.0,
            "batch_id": signed.batch_id,
            "nonce": signed.nonce,
            "deadline": signed.deadline,
            "signature": signed.signature
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Expired deadline must fail
    let (_, expired_sig): (_, SignDemoIntentResponse) = send_json(
        &app,
        "POST",
        "/api/orders/sign-demo-intent",
        Some(json!({
            "demo_account_index": 2,
            "side": "BuyBase",
            "amount_in": 1000.0,
            "limit_price": 3200.0,
            "batch_id": 1,
            "deadline": 100
        })),
    )
    .await;
    let (status, _): (_, Value) = send_json(
        &app,
        "POST",
        "/api/orders/intent",
        Some(json!({
            "trader": expired_sig.trader,
            "side": "BuyBase",
            "amount_in": 1000.0,
            "limit_price": 3200.0,
            "batch_id": 1,
            "nonce": expired_sig.nonce,
            "deadline": expired_sig.deadline,
            "signature": expired_sig.signature
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Settle and Claim Carol's BuyBase payout (WETH)
    let (_, settled): (_, SettleBatchResponse) =
        send_json(&app, "POST", "/api/batch/settle", None).await;
    let fill = &settled.settlement.fills[0];
    assert_eq!(fill.side, OrderSide::BuyBase);
    assert!(fill.payout_out > 1.8);

    let (status, claimed): (_, ClaimBatchResponse) = send_json(
        &app,
        "POST",
        "/api/batch/claim",
        Some(json!({
            "trader": signed.trader,
            "claims": [{ "batch_id": 1, "order_id": fill.order_id }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!((claimed.claimed_base - fill.payout_out).abs() < 1e-9);
    assert_eq!(claimed.claimed_quote, 0.0);
    assert!(claimed.state.claimable[0].claimed);

    // Double-claim must fail
    let (status, _): (_, Value) = send_json(
        &app,
        "POST",
        "/api/batch/claim",
        Some(json!({
            "trader": signed.trader,
            "claims": [{ "batch_id": 1, "order_id": fill.order_id }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_stateless_compare_and_reset_endpoint() {
    let app = test_app();

    let (status, cmp): (_, StatelessCompareResponse) = send_json(
        &app,
        "POST",
        "/api/compare",
        Some(json!({
            "rx": 100.0,
            "ry": 300000.0,
            "fee_bps": 30,
            "include_sandwich_bot": true,
            "orders": [
                { "side": "SellBase", "amount_in": 2.0, "limit_price": 2300.0 },
                { "side": "SellBase", "amount_in": 2.0, "limit_price": 2300.0 }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cmp.settlement.comparison.fairbatch_sandwich_profit_quote, 0.0);
    assert!(cmp.settlement.comparison.amm_sandwich_profit_quote > 500.0);

    // Verify /api/compare did not mutate stateful engine
    let (_, st): (_, StateResponse) = send_json(&app, "GET", "/api/state", None).await;
    assert!(st.orders.is_empty());

    // Empty-body POST /api/reset and custom-reserves POST /api/reset both succeed
    let (status, _): (_, StateResponse) = send_json(&app, "POST", "/api/reset", None).await;
    assert_eq!(status, StatusCode::OK);

    let (status, reset_custom): (_, StateResponse) = send_json(
        &app,
        "POST",
        "/api/reset",
        Some(json!({ "rx": 50.0, "ry": 150000.0 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reset_custom.reserves.rx, 50.0);
    assert_eq!(reset_custom.reserves.ry, 150_000.0);
}

#[tokio::test]
async fn test_whale_imbalance_preset_and_direct_order_phase_guard() {
    let app = test_app();

    let (status, whale_state): (_, StateResponse) = send_json(
        &app,
        "POST",
        "/api/presets/load",
        Some(json!({
            "preset": "whale_imbalance",
            "include_sandwich_bot": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(whale_state.orders.len(), 3);

    let (status, settled): (_, SettleBatchResponse) =
        send_json(&app, "POST", "/api/batch/settle", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!((settled.settlement.clearing_price - 2080.0).abs() < 1e-6);
    assert!(settled.settlement.k_invariant_growth > 1_000_000.0);
    assert!(settled.settlement.k_invariant_growth_pct > 3.3);

    // Direct order works in Open phase (Batch #2)
    let alice = &settled.state.demo_wallets[0].address;
    let (status, after_direct): (_, StateResponse) = send_json(
        &app,
        "POST",
        "/api/orders/direct",
        Some(json!({
            "trader": alice,
            "side": "SellBase",
            "amount_in": 1.5,
            "limit_price": 1900.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(after_direct.orders.len(), 1);
    assert_eq!(after_direct.orders[0].submission_type, SubmissionType::Direct);

    // Advance to Reveal -> Direct order must be rejected in Reveal phase
    let (_, _): (_, StateResponse) = send_json(&app, "POST", "/api/batch/advance", None).await;
    let (status, _): (_, Value) = send_json(
        &app,
        "POST",
        "/api/orders/direct",
        Some(json!({
            "trader": alice,
            "side": "SellBase",
            "amount_in": 1.0,
            "limit_price": 1900.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[test]
fn test_eip712_personal_sign_and_high_s_malleability_rejection() {
    use fairbatch_backend::intent::{
        compute_personal_sign_digest, get_demo_wallet, recover_signer_from_digest,
        sign_prehash_ethereum, verify_signed_order, SignedOrderParams,
    };

    let alice = get_demo_wallet(0).unwrap();
    let params = SignedOrderParams {
        chain_id: 11155111,
        verifying_contract: [0u8; 20],
        trader: alice.address_bytes,
        side: OrderSide::SellBase,
        amount_in: 1.0,
        limit_price: 2500.0,
        batch_id: 1,
        nonce: 0,
        deadline: 2_000_000_000,
        base_decimals: 18,
        quote_decimals: 6,
    };

    // 1. Browser personal_sign over EIP-712 digest verifies cleanly
    let canonical = params.canonical_digest();
    let personal_digest = compute_personal_sign_digest(&canonical);
    let personal_sig = sign_prehash_ethereum(&alice.signing_key, &personal_digest).unwrap();
    let recovered = verify_signed_order(&params, &personal_sig).unwrap();
    assert_eq!(recovered, alice.address_bytes);

    // 2. High-S malleable signature (s = secp256k1_n - low_s) is strictly rejected (EIP-2)
    let valid_sig = sign_prehash_ethereum(&alice.signing_key, &canonical).unwrap();
    let mut raw_sig = hex::decode(&valid_sig[2..]).unwrap();
    // Set s = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140 (> n/2, < n)
    let high_s = hex::decode("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140").unwrap();
    raw_sig[32..64].copy_from_slice(&high_s);
    let malleable_hex = format!("0x{}", hex::encode(&raw_sig));
    let err = recover_signer_from_digest(&canonical, &malleable_hex).unwrap_err();
    assert!(err.contains("EIP-2"));
}

#[test]
fn test_cross_tier_fe_evm_exact_atom_parity() {
    use fairbatch_backend::{
        clearing::{solve_batch_tokens, ClearingOrder},
        math::f64_to_raw,
    };

    // Exact match against compiled `FairBatch.bin` deployed on Ethereum Sepolia:
    // Pool: 100 WETH (18d) + 300,000 USDC (6d); 5 sellers x 1 WETH each ->
    // Total claimed = 13,636,363,635 raw USDC (5 * 2,727,272,727), pool after = 286,363,636,365 raw USDC.
    let rx_raw = f64_to_raw(100.0, 18);
    let ry_raw = f64_to_raw(300_000.0, 6);
    let orders: Vec<ClearingOrder> = (1..=5)
        .map(|id| {
            ClearingOrder::from_human(
                id,
                id as usize,
                format!("0x{:040x}", id),
                format!("User{id}"),
                OrderSide::SellBase,
                1.0,
                2350.0,
                false,
                18,
                6,
            )
        })
        .collect();

    let out = solve_batch_tokens(rx_raw, ry_raw, 18, 6, &orders);
    let sum_payouts: u128 = out.raw_fills.iter().map(|f| f.payout_out_raw).sum();
    assert_eq!(sum_payouts, 13_636_363_635u128);
    assert_eq!(out.ry_raw_after, 286_363_636_365u128);
    assert_eq!(out.rx_raw_after, 105_000_000_000_000_000_000u128);
}

#[tokio::test]
async fn test_buy_base_zero_limit_price_rejected_while_sell_base_zero_allowed() {
    let app = test_app();
    let (_, init_state): (_, StateResponse) = send_json(&app, "GET", "/api/state", None).await;
    let alice = &init_state.demo_wallets[0].address;

    // BuyBase with limit_price == 0.0 must be rejected (matches `src/lib.fe::validate_order_params`)
    let (status, _): (_, Value) = send_json(
        &app,
        "POST",
        "/api/orders/direct",
        Some(json!({
            "trader": alice,
            "side": "BuyBase",
            "amount_in": 1000.0,
            "limit_price": 0.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // SellBase with limit_price == 0.0 (market sell) is allowed
    let (status, st): (_, StateResponse) = send_json(
        &app,
        "POST",
        "/api/orders/direct",
        Some(json!({
            "trader": alice,
            "side": "SellBase",
            "amount_in": 1.0,
            "limit_price": 0.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(st.orders.len(), 1);
}
