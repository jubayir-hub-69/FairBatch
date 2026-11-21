//! Smart Contract Artifact Inspector & Sepolia JSON-RPC Bridge (`chain.rs`).
//!
//! Loads Ethereum Sepolia contract addresses (`fairBatch`, `baseToken`, `quoteToken`,
//! `faucet`) and RPC configuration from the shared global `config/deployment.json`
//! (with fallback to `deployments/sepolia.json`), scans `../out/` for compiled Fe 26.5.0
//! artifacts, and provides read/broadcast JSON-RPC forwarding on Ethereum Sepolia.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::intent::{keccak256, parse_eth_address, to_checksum_address};

pub const ZERO_ADDRESS: &str = "0x0000000000000000000000000000000000000000";
pub const SEPOLIA_CHAIN_ID: u64 = 11155111;
pub const DEFAULT_CHAIN_ID: u64 = SEPOLIA_CHAIN_ID;
pub const DEFAULT_SEPOLIA_RPC_URL: &str = "https://ethereum-sepolia-rpc.publicnode.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractAddressesDto {
    pub fair_batch: String,
    pub base_token: String,
    pub quote_token: String,
    pub faucet: String,
    pub deployed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub execution_mode: String, // "local_engine" | "rpc_connected"
    pub rpc_url: Option<String>,
    pub chain_id: u64,
    pub contracts: ContractAddressesDto,
    pub fe_artifacts_present: bool,
    pub fe_artifacts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactDetailDto {
    pub file_name: String,
    pub size_bytes: u64,
    pub kind: String,
    pub abi: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportedNetworkDto {
    pub name: String,
    pub chain_id: u64,
    pub cancun_eip1153_ready: bool,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractsMetadataResponse {
    pub execution_mode: String,
    pub rpc_url: Option<String>,
    pub chain_id: u64,
    pub contracts: ContractAddressesDto,
    pub fe_artifacts_present: bool,
    pub artifacts: Vec<ArtifactDetailDto>,
    pub sepolia_deployment: Option<Value>,
    pub supported_networks: Vec<SupportedNetworkDto>,
}

#[derive(Debug, Clone)]
pub struct ChainBridgeConfig {
    pub rpc_url: Option<String>,
    pub chain_id: u64,
    pub fair_batch: String,
    pub base_token: String,
    pub quote_token: String,
    pub faucet: String,
}

impl Default for ChainBridgeConfig {
    fn default() -> Self {
        Self {
            rpc_url: Some(DEFAULT_SEPOLIA_RPC_URL.to_string()),
            chain_id: SEPOLIA_CHAIN_ID,
            fair_batch: ZERO_ADDRESS.to_string(),
            base_token: ZERO_ADDRESS.to_string(),
            quote_token: ZERO_ADDRESS.to_string(),
            faucet: ZERO_ADDRESS.to_string(),
        }
    }
}

impl ChainBridgeConfig {
    /// Loads contract addresses and RPC settings from the shared global
    /// `config/deployment.json` (and falls back to `deployments/sepolia.json`
    /// for any unset fields). Optional `RPC_URL` env var may override the
    /// Sepolia RPC endpoint, but chain ID is strictly Sepolia (`11155111`) and
    /// contract addresses are never sourced from `.env`.
    pub fn from_global_config() -> Self {
        let mut cfg = Self::default();
        if let Some(global_cfg) = load_global_deployment_config() {
            cfg.apply_manifest_fallback(&global_cfg);
        }
        if let Some(manifest) = load_sepolia_deployment_manifest() {
            cfg.apply_manifest_fallback(&manifest);
        }
        if let Ok(env_rpc) = std::env::var("RPC_URL") {
            let trimmed = env_rpc.trim();
            if !trimmed.is_empty() && !is_local_rpc_url(trimmed) {
                cfg.rpc_url = Some(trimmed.to_string());
            }
        }
        cfg.chain_id = SEPOLIA_CHAIN_ID;
        cfg
    }

    pub fn from_env() -> Self {
        Self::from_global_config()
    }

    pub fn from_env_with_manifest() -> Self {
        Self::from_global_config()
    }

    /// Populates unset (`0x000...000`) contract addresses and RPC URL from a parsed
    /// deployment config or manifest (`config/deployment.json` or `deployments/sepolia.json`)
    /// when it targets Ethereum Sepolia (`11155111`).
    pub fn apply_manifest_fallback(&mut self, manifest: &Value) {
        let manifest_chain_id = manifest
            .get("chainId")
            .or_else(|| manifest.get("chain_id"))
            .and_then(|v| v.as_u64())
            .or_else(|| {
                manifest
                    .get("network")
                    .and_then(|v| v.as_str())
                    .and_then(|n| {
                        if n.eq_ignore_ascii_case("sepolia") {
                            Some(SEPOLIA_CHAIN_ID)
                        } else {
                            None
                        }
                    })
            })
            .unwrap_or(SEPOLIA_CHAIN_ID);

        if manifest_chain_id != SEPOLIA_CHAIN_ID {
            return;
        }
        self.chain_id = SEPOLIA_CHAIN_ID;

        if self.fair_batch == ZERO_ADDRESS {
            if let Some(addr) = extract_manifest_address(
                manifest,
                &["fairBatch", "fair_batch", "fairbatch_address", "fairBatchAddress"],
            ) {
                self.fair_batch = addr;
            }
        }
        if self.base_token == ZERO_ADDRESS {
            if let Some(addr) = extract_manifest_address(
                manifest,
                &["baseToken", "base_token", "base_token_address", "weth", "fWETH"],
            ) {
                self.base_token = addr;
            }
        }
        if self.quote_token == ZERO_ADDRESS {
            if let Some(addr) = extract_manifest_address(
                manifest,
                &["quoteToken", "quote_token", "quote_token_address", "usdc", "fUSDC"],
            ) {
                self.quote_token = addr;
            }
        }
        if self.faucet == ZERO_ADDRESS {
            if let Some(addr) = extract_manifest_address(
                manifest,
                &["faucet", "faucetAddress", "faucet_address"],
            ) {
                self.faucet = addr;
            }
        }
        if let Some(rpc) = manifest
            .get("rpcUrl")
            .or_else(|| manifest.get("rpc_url"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && !is_local_rpc_url(s))
        {
            self.rpc_url = Some(rpc);
        }
    }

    pub fn verifying_contract_bytes(&self) -> [u8; 20] {
        parse_eth_address(&self.fair_batch).unwrap_or([0u8; 20])
    }

    pub fn is_contract_deployed(&self) -> bool {
        let bytes = self.verifying_contract_bytes();
        bytes != [0u8; 20]
    }

    pub fn execution_mode(&self) -> &'static str {
        if self.rpc_url.is_some() && self.is_contract_deployed() {
            "rpc_connected"
        } else {
            "local_engine"
        }
    }

    pub fn contracts_dto(&self) -> ContractAddressesDto {
        ContractAddressesDto {
            fair_batch: self.fair_batch.clone(),
            base_token: self.base_token.clone(),
            quote_token: self.quote_token.clone(),
            faucet: self.faucet.clone(),
            deployed: self.is_contract_deployed(),
        }
    }

    pub fn build_health_response(&self) -> HealthResponse {
        let artifacts = scan_fe_artifacts();
        let names: Vec<String> = artifacts.into_iter().map(|a| a.file_name).collect();
        HealthResponse {
            status: "ok".to_string(),
            execution_mode: self.execution_mode().to_string(),
            rpc_url: self.rpc_url.clone(),
            chain_id: self.chain_id,
            contracts: self.contracts_dto(),
            fe_artifacts_present: !names.is_empty(),
            fe_artifacts: names,
        }
    }

    pub fn build_contracts_metadata(&self) -> ContractsMetadataResponse {
        let artifacts = scan_fe_artifacts();
        ContractsMetadataResponse {
            execution_mode: self.execution_mode().to_string(),
            rpc_url: self.rpc_url.clone(),
            chain_id: self.chain_id,
            contracts: self.contracts_dto(),
            fe_artifacts_present: !artifacts.is_empty(),
            artifacts,
            sepolia_deployment: load_sepolia_deployment_manifest(),
            supported_networks: vec![SupportedNetworkDto {
                name: "Ethereum Sepolia Testnet".to_string(),
                chain_id: SEPOLIA_CHAIN_ID,
                cancun_eip1153_ready: true,
                notes: "Ethereum Sepolia deployment supporting PUSH0, MCOPY, and EIP-1153 TLOAD/TSTORE.".to_string(),
            }],
        }
    }

    /// Performs a read-only JSON-RPC `eth_call` against `self.fair_batch` on Sepolia.
    pub async fn eth_call(&self, calldata_hex: &str) -> Result<String, String> {
        let rpc = self
            .rpc_url
            .as_ref()
            .ok_or_else(|| "Sepolia RPC URL is not configured".to_string())?;
        if !self.is_contract_deployed() {
            return Err("FairBatch contract address is unset in config/deployment.json".to_string());
        }

        let payload = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [
                {
                    "to": self.fair_batch,
                    "data": calldata_hex,
                },
                "latest"
            ]
        });

        send_json_rpc(rpc, &payload).await
    }

    /// Forwards a pre-signed raw transaction (`eth_sendRawTransaction`) to Ethereum Sepolia.
    pub async fn send_raw_transaction(&self, signed_tx_hex: &str) -> Result<String, String> {
        let rpc = self
            .rpc_url
            .as_ref()
            .ok_or_else(|| "Sepolia RPC URL is not configured".to_string())?;

        let payload = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_sendRawTransaction",
            "params": [signed_tx_hex]
        });

        send_json_rpc(rpc, &payload).await
    }
}

fn is_local_rpc_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("127.0.0.1") || lower.contains("localhost") || lower.contains("::1")
}

async fn send_json_rpc(rpc_url: &str, payload: &Value) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| format!("HTTP client init error: {e}"))?;

    let resp = client
        .post(rpc_url)
        .json(payload)
        .send()
        .await
        .map_err(|e| format!("JSON-RPC request failed: {e}"))?;

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid JSON-RPC response: {e}"))?;

    if let Some(err) = body.get("error") {
        return Err(format!("EVM RPC error: {err}"));
    }

    body.get("result")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Missing `result` string in JSON-RPC response".to_string())
}

/// Computes 4-byte Solidity/Fe function selector `keccak256(sig)[0..4]` as `0x`-prefixed hex.
pub fn function_selector(signature: &str) -> String {
    let hash = keccak256(signature.as_bytes());
    format!("0x{}", hex::encode(&hash[0..4]))
}

fn validate_or_zero_address(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(ZERO_ADDRESS.to_string());
    }
    let bytes = parse_eth_address(trimmed)?;
    if bytes == [0u8; 20] {
        Ok(ZERO_ADDRESS.to_string())
    } else {
        Ok(to_checksum_address(&bytes))
    }
}

fn locate_out_directory() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("../out"),
        PathBuf::from("out"),
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../out"),
    ];
    candidates.into_iter().find(|path| path.is_dir())
}

/// Scans `out/` recursively (up to 2 levels) for Fe build outputs (`.bin`, `.runtime.bin`, `.abi`, `.json`).
pub fn scan_fe_artifacts() -> Vec<ArtifactDetailDto> {
    let Some(out_dir) = locate_out_directory() else {
        return Vec::new();
    };

    let mut files = Vec::new();
    collect_artifacts_in_dir(&out_dir, "", 0, &mut files);
    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    files.dedup_by(|a, b| a.file_name == b.file_name);
    files
}

fn collect_artifacts_in_dir(
    dir: &Path,
    prefix: &str,
    depth: usize,
    acc: &mut Vec<ArtifactDetailDto>,
) {
    if depth > 2 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let rel_name = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{prefix}/{name}")
        };

        if path.is_dir() {
            collect_artifacts_in_dir(&path, &rel_name, depth + 1, acc);
        } else if path.is_file() {
            let is_relevant = name.ends_with(".bin")
                || name.ends_with(".abi")
                || name.ends_with(".json")
                || name.ends_with(".yul")
                || name.ends_with(".ir");
            if !is_relevant {
                continue;
            }
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let kind = if name.ends_with(".runtime.bin") {
                "runtime_bytecode"
            } else if name.ends_with(".bin") {
                "deploy_bytecode"
            } else if name.contains("abi") || name.ends_with(".json") {
                "abi_json"
            } else {
                "compiler_artifact"
            }
            .to_string();

            let abi = if kind == "abi_json" && size_bytes <= 512_000 {
                std::fs::read_to_string(&path).ok().and_then(|raw| {
                    let clean = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
                    serde_json::from_str::<Value>(clean).ok()
                })
            } else {
                None
            };

            acc.push(ArtifactDetailDto {
                file_name: rel_name,
                size_bytes,
                kind,
                abi,
            });
        }
    }
}

/// Zero-dependency `.env` parser supporting `#` comments, inline `#` comments,
/// `export KEY=VALUE`, single/double-quoted values, UTF-8 BOM stripping, and skipping empty keys/values.
pub fn parse_dotenv_content(content: &str) -> Vec<(String, String)> {
    let stripped = content.strip_prefix('\u{feff}').unwrap_or(content);
    let mut pairs = Vec::new();

    for raw_line in stripped.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line
            .strip_prefix("export ")
            .map(str::trim_start)
            .unwrap_or(line);

        let Some((raw_key, raw_val)) = line.split_once('=') else {
            continue;
        };
        let key = raw_key.trim();
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            continue;
        }

        let val_trimmed = raw_val.trim();
        if val_trimmed.is_empty() || val_trimmed.starts_with('#') {
            continue;
        }

        let parsed_val = if let Some(after_dquote) = val_trimmed.strip_prefix('"') {
            let mut out = String::new();
            let mut escaped = false;
            for ch in after_dquote.chars() {
                if escaped {
                    match ch {
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        other => out.push(other),
                    }
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    break;
                } else {
                    out.push(ch);
                }
            }
            out
        } else if let Some(after_squote) = val_trimmed.strip_prefix('\'') {
            after_squote
                .split_once('\'')
                .map(|(inner, _)| inner.to_string())
                .unwrap_or_else(|| after_squote.to_string())
        } else {
            strip_inline_comment(val_trimmed).trim().to_string()
        };

        if !parsed_val.is_empty() {
            pairs.push((key.to_string(), parsed_val));
        }
    }

    pairs
}

fn strip_inline_comment(unquoted: &str) -> &str {
    let bytes = unquoted.as_bytes();
    for i in 1..bytes.len() {
        if bytes[i] == b'#' && bytes[i - 1].is_ascii_whitespace() {
            return &unquoted[..i - 1];
        }
    }
    unquoted
}

/// Loads `.env` from CWD or workspace root (`../.env`) without overriding already-set
/// process environment variables. Safe to call at single-threaded process startup in `main.rs`.
pub fn load_dotenv_if_present() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(".env"),
        PathBuf::from("../.env"),
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env"),
    ];
    let found = candidates.into_iter().find(|p| p.is_file())?;
    let raw = std::fs::read_to_string(&found).ok()?;
    for (k, v) in parse_dotenv_content(&raw) {
        if std::env::var_os(&k).is_none() {
            std::env::set_var(&k, &v);
        }
    }
    Some(found)
}

fn locate_global_deployment_config() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("../config/deployment.json"),
        PathBuf::from("config/deployment.json"),
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../config/deployment.json"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

fn locate_sepolia_manifest() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("../deployments/sepolia.json"),
        PathBuf::from("deployments/sepolia.json"),
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../deployments/sepolia.json"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

/// Parses a deployment JSON string (stripping any Windows UTF-8 BOM `\u{feff}`),
/// and redacts any accidental secret-bearing keys.
pub fn parse_deployment_manifest_str(raw: &str) -> Option<Value> {
    let clean = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let mut parsed = serde_json::from_str::<Value>(clean).ok()?;
    redact_manifest_secrets(&mut parsed);
    Some(parsed)
}

/// Loads the shared global `config/deployment.json` if present.
pub fn load_global_deployment_config() -> Option<Value> {
    let path = locate_global_deployment_config()?;
    let raw = std::fs::read_to_string(path).ok()?;
    parse_deployment_manifest_str(&raw)
}

/// Loads `deployments/sepolia.json` if present, redacting any accidental secret-bearing keys.
pub fn load_sepolia_deployment_manifest() -> Option<Value> {
    let path = locate_sepolia_manifest()?;
    let raw = std::fs::read_to_string(path).ok()?;
    parse_deployment_manifest_str(&raw)
}

fn redact_manifest_secrets(val: &mut Value) {
    match val {
        Value::Object(map) => {
            map.retain(|k, _| {
                let lower = k.to_ascii_lowercase();
                !lower.contains("private_key")
                    && !lower.contains("privatekey")
                    && !lower.contains("secret")
                    && !lower.contains("mnemonic")
            });
            for v in map.values_mut() {
                redact_manifest_secrets(v);
            }
        }
        Value::Array(arr) => {
            for item in arr {
                redact_manifest_secrets(item);
            }
        }
        _ => {}
    }
}

fn extract_manifest_address(manifest: &Value, keys: &[&str]) -> Option<String> {
    let scopes: [Option<&Value>; 2] = [manifest.get("contracts"), Some(manifest)];
    for scope in scopes.into_iter().flatten() {
        for &key in keys {
            if let Some(entry) = scope.get(key) {
                let addr_str = entry
                    .as_str()
                    .or_else(|| entry.get("address").and_then(|v| v.as_str()));
                if let Some(s) = addr_str {
                    if let Ok(normalized) = validate_or_zero_address(s) {
                        if normalized != ZERO_ADDRESS {
                            return Some(normalized);
                        }
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_chain_config_defaults_to_sepolia_only() {
        let cfg = ChainBridgeConfig::default();
        assert_eq!(cfg.chain_id, SEPOLIA_CHAIN_ID);
        assert_eq!(cfg.execution_mode(), "local_engine");
        assert!(!cfg.is_contract_deployed());

        let meta = cfg.build_contracts_metadata();
        assert_eq!(meta.supported_networks.len(), 1);
        assert_eq!(meta.supported_networks[0].chain_id, SEPOLIA_CHAIN_ID);
    }

    #[test]
    fn test_function_selector() {
        assert_eq!(function_selector("transfer(address,uint256)"), "0xa9059cbb");
    }

    #[test]
    fn test_dotenv_parsing_comments_quotes_and_empty_keys() {
        let sample_env = "\u{feff}# FairBatch Server Runtime Configuration\n\
            HOST=127.0.0.1 # bind host\n\
            PORT=3001\n\
            export RPC_URL=\"https://ethereum-sepolia-rpc.publicnode.com\"\n\
            DEPLOYER_PRIVATE_KEY=\n\
            SOLVER_PRIVATE_KEY=\"\"\n\
            =invalid_empty_key\n";

        let parsed: HashMap<String, String> = parse_dotenv_content(sample_env).into_iter().collect();
        assert_eq!(parsed.get("HOST").map(String::as_str), Some("127.0.0.1"));
        assert_eq!(parsed.get("PORT").map(String::as_str), Some("3001"));
        assert_eq!(
            parsed.get("RPC_URL").map(String::as_str),
            Some("https://ethereum-sepolia-rpc.publicnode.com")
        );
        assert!(!parsed.contains_key("DEPLOYER_PRIVATE_KEY"));
        assert!(!parsed.contains_key("SOLVER_PRIVATE_KEY"));
        assert!(!parsed.contains_key(""));
    }

    #[test]
    fn test_global_deployment_config_parsing_faucet_and_secret_redaction() {
        let mut cfg = ChainBridgeConfig::default();
        assert_eq!(cfg.execution_mode(), "local_engine");

        let bom_prefixed_raw = "\u{feff}{\
            \"network\": \"sepolia\",\
            \"chainId\": 11155111,\
            \"rpcUrl\": \"https://ethereum-sepolia-rpc.publicnode.com\",\
            \"deployer_private_key\": \"0xdeadbeef_must_be_stripped\",\
            \"contracts\": {\
                \"fairBatch\": \"0xb665658f7ce673de350799823045384afc0302ce\",\
                \"baseToken\": \"0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14\",\
                \"quoteToken\": \"0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238\",\
                \"faucet\": \"0x4444444444444444444444444444444444444444\"\
            }\
        }";
        let manifest = parse_deployment_manifest_str(bom_prefixed_raw).expect("BOM JSON must parse");
        assert!(manifest.get("deployer_private_key").is_none());

        cfg.apply_manifest_fallback(&manifest);
        assert_eq!(cfg.execution_mode(), "rpc_connected");
        assert_eq!(cfg.chain_id, SEPOLIA_CHAIN_ID);
        assert_eq!(
            cfg.fair_batch.to_lowercase(),
            "0xb665658f7ce673de350799823045384afc0302ce"
        );
        assert_eq!(
            cfg.faucet.to_lowercase(),
            "0x4444444444444444444444444444444444444444"
        );
    }

    #[test]
    fn test_local_fork_manifest_and_rpc_ignored() {
        let mut cfg = ChainBridgeConfig::default();
        let anvil_manifest = json!({
            "network": "anvil",
            "chainId": 31337,
            "rpcUrl": "http://127.0.0.1:8545",
            "contracts": {
                "fairBatch": "0x1111111111111111111111111111111111111111"
            }
        });
        cfg.apply_manifest_fallback(&anvil_manifest);
        assert_eq!(cfg.chain_id, SEPOLIA_CHAIN_ID);
        assert_eq!(cfg.fair_batch, ZERO_ADDRESS);
        assert!(is_local_rpc_url("http://127.0.0.1:8545"));
        assert!(is_local_rpc_url("http://localhost:8546"));
        assert!(!is_local_rpc_url("https://ethereum-sepolia-rpc.publicnode.com"));
    }
}
