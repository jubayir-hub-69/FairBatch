//! Axum HTTP router and JSON handlers for FairBatch (`/api/*`).

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;

use crate::chain::{ChainBridgeConfig, ContractsMetadataResponse, HealthResponse};
use crate::state::{
    run_stateless_compare, ClaimBatchRequest, ClaimBatchResponse, CommitOrderRequest,
    CommitOrderResponse, ComputeHashRequest, ComputeHashResponse, DirectOrderRequest,
    FairBatchEngine, LoadPresetRequest, ResetRequest, RevealOrderRequest, SettleBatchResponse,
    SignDemoIntentRequest, SignDemoIntentResponse, StateResponse, StatelessCompareRequest,
    StatelessCompareResponse, SubmitIntentRequest,
};

pub type SharedEngine = Arc<RwLock<FairBatchEngine>>;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl ApiError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg.into(),
        }
    }

    pub fn bad_gateway(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            message: msg.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({
                "error": self.message,
            })),
        )
            .into_response()
    }
}

pub fn build_shared_engine() -> SharedEngine {
    let cfg = ChainBridgeConfig::from_env();
    Arc::new(RwLock::new(FairBatchEngine::new(cfg)))
}

pub fn build_shared_engine_with_manifest() -> SharedEngine {
    let cfg = ChainBridgeConfig::from_env_with_manifest();
    Arc::new(RwLock::new(FairBatchEngine::new(cfg)))
}

pub fn build_router(state: SharedEngine) -> Router {
    Router::new()
        .route("/api/health", get(get_health))
        .route("/api/contracts", get(get_contracts))
        .route("/api/state", get(get_state))
        .route("/api/orders/direct", post(post_direct_order))
        .route("/api/orders/compute-hash", post(post_compute_hash))
        .route("/api/orders/commit", post(post_commit_order))
        .route("/api/orders/reveal", post(post_reveal_order))
        .route("/api/orders/sign-demo-intent", post(post_sign_demo_intent))
        .route("/api/orders/intent", post(post_submit_intent))
        .route("/api/presets/load", post(post_load_preset))
        .route("/api/batch/advance", post(post_advance_batch))
        .route("/api/batch/settle", post(post_settle_batch))
        .route("/api/batch/claim", post(post_claim_batch))
        .route("/api/compare", post(post_stateless_compare))
        .route("/api/chain/eth-call", post(post_chain_eth_call))
        .route("/api/chain/send-raw-tx", post(post_chain_send_raw_tx))
        .route("/api/reset", post(post_reset))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn get_health(State(engine): State<SharedEngine>) -> Json<HealthResponse> {
    let guard = engine.read().await;
    Json(guard.chain.build_health_response())
}

async fn get_contracts(State(engine): State<SharedEngine>) -> Json<ContractsMetadataResponse> {
    let guard = engine.read().await;
    Json(guard.chain.build_contracts_metadata())
}

async fn get_state(State(engine): State<SharedEngine>) -> Json<StateResponse> {
    let guard = engine.read().await;
    Json(guard.snapshot_state())
}

async fn post_direct_order(
    State(engine): State<SharedEngine>,
    Json(req): Json<DirectOrderRequest>,
) -> Result<Json<StateResponse>, ApiError> {
    let mut guard = engine.write().await;
    guard
        .submit_direct(req)
        .map(Json)
        .map_err(ApiError::bad_request)
}

async fn post_compute_hash(
    State(engine): State<SharedEngine>,
    Json(req): Json<ComputeHashRequest>,
) -> Result<Json<ComputeHashResponse>, ApiError> {
    let guard = engine.read().await;
    guard
        .compute_hash(req)
        .map(Json)
        .map_err(ApiError::bad_request)
}

async fn post_commit_order(
    State(engine): State<SharedEngine>,
    Json(req): Json<CommitOrderRequest>,
) -> Result<Json<CommitOrderResponse>, ApiError> {
    let mut guard = engine.write().await;
    guard
        .commit_order(req)
        .map(Json)
        .map_err(ApiError::bad_request)
}

async fn post_reveal_order(
    State(engine): State<SharedEngine>,
    Json(req): Json<RevealOrderRequest>,
) -> Result<Json<StateResponse>, ApiError> {
    let mut guard = engine.write().await;
    guard
        .reveal_order(req)
        .map(Json)
        .map_err(ApiError::bad_request)
}

async fn post_sign_demo_intent(
    State(engine): State<SharedEngine>,
    Json(req): Json<SignDemoIntentRequest>,
) -> Result<Json<SignDemoIntentResponse>, ApiError> {
    let guard = engine.read().await;
    guard
        .sign_demo_intent(req)
        .map(Json)
        .map_err(ApiError::bad_request)
}

async fn post_submit_intent(
    State(engine): State<SharedEngine>,
    Json(req): Json<SubmitIntentRequest>,
) -> Result<Json<StateResponse>, ApiError> {
    let mut guard = engine.write().await;
    guard
        .submit_signed_intent(req)
        .map(Json)
        .map_err(ApiError::bad_request)
}

async fn post_load_preset(
    State(engine): State<SharedEngine>,
    Json(req): Json<LoadPresetRequest>,
) -> Result<Json<StateResponse>, ApiError> {
    let mut guard = engine.write().await;
    guard
        .load_preset(req)
        .map(Json)
        .map_err(ApiError::bad_request)
}

async fn post_advance_batch(
    State(engine): State<SharedEngine>,
) -> Result<Json<StateResponse>, ApiError> {
    let mut guard = engine.write().await;
    guard
        .advance_phase()
        .map(Json)
        .map_err(ApiError::bad_request)
}

async fn post_settle_batch(
    State(engine): State<SharedEngine>,
) -> Result<Json<SettleBatchResponse>, ApiError> {
    let mut guard = engine.write().await;
    guard
        .settle_batch()
        .map(Json)
        .map_err(ApiError::bad_request)
}

async fn post_claim_batch(
    State(engine): State<SharedEngine>,
    Json(req): Json<ClaimBatchRequest>,
) -> Result<Json<ClaimBatchResponse>, ApiError> {
    let mut guard = engine.write().await;
    guard
        .claim_batch(req)
        .map(Json)
        .map_err(ApiError::bad_request)
}

async fn post_stateless_compare(
    Json(req): Json<StatelessCompareRequest>,
) -> Result<Json<StatelessCompareResponse>, ApiError> {
    run_stateless_compare(req)
        .map(Json)
        .map_err(ApiError::bad_request)
}

#[derive(Debug, Deserialize)]
struct EthCallRequest {
    calldata: String,
}

async fn post_chain_eth_call(
    State(engine): State<SharedEngine>,
    Json(req): Json<EthCallRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cfg = {
        let guard = engine.read().await;
        guard.chain.clone()
    };
    let result = cfg
        .eth_call(&req.calldata)
        .await
        .map_err(ApiError::bad_gateway)?;
    Ok(Json(json!({ "result": result })))
}

#[derive(Debug, Deserialize)]
struct RawTxRequest {
    signed_tx: String,
}

async fn post_chain_send_raw_tx(
    State(engine): State<SharedEngine>,
    Json(req): Json<RawTxRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let cfg = {
        let guard = engine.read().await;
        guard.chain.clone()
    };
    let tx_hash = cfg
        .send_raw_transaction(&req.signed_tx)
        .await
        .map_err(ApiError::bad_gateway)?;
    Ok(Json(json!({ "tx_hash": tx_hash })))
}

async fn post_reset(
    State(engine): State<SharedEngine>,
    body: Bytes,
) -> Result<Json<StateResponse>, ApiError> {
    let req: ResetRequest = if body.is_empty() {
        ResetRequest::default()
    } else {
        serde_json::from_slice(&body)
            .map_err(|e| ApiError::bad_request(format!("Invalid reset JSON payload: {e}")))?
    };
    let mut guard = engine.write().await;
    guard
        .reset(req.rx, req.ry)
        .map(Json)
        .map_err(ApiError::bad_request)
}
