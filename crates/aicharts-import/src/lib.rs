//! Local-only usage import. Raw source identities never belong in wire payloads.
//! Callers must project these local observations into AI Charts' numeric contract.
mod checkpoint;
mod observed;
pub use checkpoint::{
    ImportCheckpoint, MAX_CHECKPOINT_BYTES, MAX_CHECKPOINT_FILES, MAX_CHECKPOINT_OBSERVATIONS,
};
pub use observed::{
    collect_observed, HealthCode, ImportHealth, ImportOutcome, ObservedImport,
    MAX_SOURCE_HEALTH_CODES, QUALIFICATION_ID,
};
pub use tokscale_core::offline::{
    all_clients, clients, collect, collect_profile, collect_since, profile_clients, token_basis,
    LocalImport, ReadReceipt, UPSTREAM_COMMIT,
};
pub use tokscale_core::sessions::{CostSource, UnifiedMessage};
#[cfg(test)]
mod observed_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn home() -> (tempfile::TempDir, std::path::PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        (temp, root)
    }

    #[test]
    fn every_primary_client_has_an_explicit_offline_lane() {
        let (_temp, root) = home();
        let ids = clients();
        assert_eq!(ids.len(), 55);
        assert_eq!(all_clients().len(), 54);
        assert!(!all_clients().contains(&"9router"));
        assert_eq!(profile_clients(), ids.as_slice());
        let profile = root.join("exclusive");
        fs::create_dir(&profile).unwrap();
        for id in ids {
            let report = collect(&root, id, std::slice::from_ref(&root))
                .unwrap_or_else(|e| panic!("{id}: {e:?}"));
            assert!(report.messages.is_empty(), "{id}");
            let report = collect_profile(
                &root,
                id,
                std::slice::from_ref(&root),
                std::slice::from_ref(&profile),
            )
            .unwrap_or_else(|e| panic!("profile {id}: {e:?}"));
            assert!(report.messages.is_empty(), "profile {id}");
        }
    }

    #[test]
    fn invalid_source_json_cannot_be_an_empty_successful_snapshot() {
        let (_temp, root) = home();
        let source = root.join(".reasonix/stats");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("2026-09-19.jsonl"), "{invalid\n").unwrap();
        assert!(collect(&root, "reasonix", std::slice::from_ref(&root)).is_err());
    }

    #[test]
    fn empty_selector_is_rejected() {
        let (_temp, root) = home();
        assert!(collect(&root, "", std::slice::from_ref(&root)).is_err());
        assert!(collect(&root, "all", std::slice::from_ref(&root)).is_err());
    }

    #[test]
    fn reasonix_preserves_counters_model_and_unknown_cost_in_utc() {
        let (_temp, root) = home();
        let source = root.join(".reasonix/stats");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("2026-09-19.jsonl"), r#"{"ts":"2026-09-19T01:00:00Z","model":"deepseek/deepseek-chat","prompt":100,"completion":20,"cache_hit":30,"cache_miss":70,"reasoning":5,"total":120,"requests":1}
"#).unwrap();
        let first = collect(&root, "reasonix", std::slice::from_ref(&root)).unwrap();
        let second = collect(&root, "reasonix", std::slice::from_ref(&root)).unwrap();
        assert_eq!(first.messages, second.messages);
        assert_eq!(first.messages.len(), 1);
        let row = &first.messages[0];
        assert_eq!(
            (
                row.tokens.input,
                row.tokens.output,
                row.tokens.cache_read,
                row.tokens.reasoning
            ),
            (70, 15, 30, 5)
        );
        assert_eq!(row.model_id, "deepseek-chat");
        assert_eq!(row.date, "2026-09-19");
        assert_eq!(row.cost_source, CostSource::Unknown);
        assert_eq!(first.receipt.files, 1);
        assert!(!root.join(".cache/tokscale").exists());
        assert!(!root.join(".config/tokscale").exists());
    }

    #[test]
    fn collect_since_preserves_in_window_events_with_old_filesystem_times() {
        let (_temp, root) = home();
        let sessions = root.join(".codex/sessions/2026/09/20");
        fs::create_dir_all(&sessions).unwrap();
        let fresh =
            sessions.join("rollout-2026-09-20T10-00-00-0192f3a4-5b6c-7d8e-9f01-23456789abcd.jsonl");
        fs::write(
            &fresh,
            concat!(
                r#"{"timestamp":"2026-09-20T10:00:00Z","type":"turn_context","payload":{"model":"gpt-5.4"}}"#,
                "\n",
                r#"{"timestamp":"2026-09-20T10:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":3,"reasoning_output_tokens":1},"last_token_usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":3,"reasoning_output_tokens":1}}}}"#,
                "\n"
            ),
        )
        .unwrap();
        // A second file predates the report window by event timestamp.
        let archived = root.join(".codex/archived_sessions/2026/08/30");
        fs::create_dir_all(&archived).unwrap();
        let stale =
            archived.join("rollout-2026-08-30T10-00-00-0192f3a4-5b6c-7d8e-9f01-23456789abcd.jsonl");
        fs::write(
            &stale,
            concat!(
                r#"{"timestamp":"2026-08-30T10:00:00Z","type":"turn_context","payload":{"model":"gpt-5.4"}}"#,
                "\n",
                r#"{"timestamp":"2026-08-30T10:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":20,"cached_input_tokens":4,"output_tokens":6,"reasoning_output_tokens":2},"last_token_usage":{"input_tokens":20,"cached_input_tokens":4,"output_tokens":6,"reasoning_output_tokens":2}}}}"#,
                "\n"
            ),
        )
        .unwrap();
        // UTC day 20716 = 2026-09-20; the stale file's mtime stays in August.
        let first_ms = 20716u64 * 86_400_000;
        fs::File::options()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_modified(
                std::time::UNIX_EPOCH + std::time::Duration::from_millis(20695 * 86_400_000),
            )
            .unwrap();

        let bounded =
            collect_since(&root, "codex", std::slice::from_ref(&root), None, first_ms).unwrap();
        assert!(!bounded.messages.is_empty());
        assert_eq!(bounded.receipt.files, 2);
        fs::File::options()
            .write(true)
            .open(&fresh)
            .unwrap()
            .set_modified(
                std::time::UNIX_EPOCH + std::time::Duration::from_millis(20695 * 86_400_000),
            )
            .unwrap();
        let copied =
            collect_since(&root, "codex", std::slice::from_ref(&root), None, first_ms).unwrap();
        assert_eq!(copied.receipt.files, 2);
        assert_eq!(bounded.messages, copied.messages);
        let full = collect(&root, "codex", std::slice::from_ref(&root)).unwrap();
        assert_eq!(full.receipt.files, 2);
    }

    #[test]
    fn unfinished_tail_is_deferred_without_losing_complete_records() {
        let (_temp, root) = home();
        let source = root.join(".reasonix/stats");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("2026-09-19.jsonl"), "{\"ts\":\"2026-09-19T01:00:00Z\",\"model\":\"deepseek/chat\",\"prompt\":10,\"completion\":2,\"total\":12}\n{\"ts\":").unwrap();
        let result = collect(&root, "reasonix", std::slice::from_ref(&root)).unwrap();
        assert_eq!(result.messages.len(), 1);
        assert_eq!(result.receipt.deferred_tail_files, 1);
    }

    #[test]
    fn existing_source_outside_approved_roots_is_rejected() {
        let (_temp, root) = home();
        let source = root.join(".reasonix/stats");
        let allowed = root.join("allowed");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir(&allowed).unwrap();
        fs::write(source.join("2026-09-19.jsonl"), "{}\n").unwrap();
        assert!(collect(&root, "reasonix", &[allowed]).is_err());
    }

    #[test]
    fn oversized_regular_file_is_rejected_before_read() {
        let (_temp, root) = home();
        let source = root.join(".reasonix/stats");
        fs::create_dir_all(&source).unwrap();
        fs::File::create(source.join("2026-09-19.jsonl"))
            .unwrap()
            .set_len(256 * 1024 * 1024 + 1)
            .unwrap();
        assert!(collect(&root, "reasonix", std::slice::from_ref(&root)).is_err());
    }

    #[test]
    fn synthetic_and_9router_do_not_duplicate_their_primary_owner() {
        let (_temp, root) = home();
        let source = root.join(".gjc/agent/sessions/project");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("session.jsonl"), r#"{"type":"session","id":"session-1"}
{"type":"message","id":"request-1","message":{"role":"assistant","model":"hf:deepseek/model","provider":"synthetic","source":"9router","timestamp":1789779600000,"usage":{"input":10,"output":5}}}
"#).unwrap();
        let owner = collect(&root, "gjc", std::slice::from_ref(&root)).unwrap();
        let narrower = collect(&root, "9router", std::slice::from_ref(&root)).unwrap();
        let native_synthetic = collect(&root, "synthetic", std::slice::from_ref(&root)).unwrap();
        assert_eq!(owner.messages.len(), 1);
        assert_eq!(owner.messages, narrower.messages);
        assert!(native_synthetic.messages.is_empty());
    }

    #[test]
    fn commandcode_marks_only_the_legacy_fallback_as_estimated() {
        let (_temp, root) = home();
        let source = root.join(".commandcode/projects/project");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("session.jsonl"), r#"{"type":"session","version":3,"id":"session-1"}
{"type":"message","id":"r1","timestamp":"2026-09-19T01:00:00Z","model":"deepseek/deepseek-chat","message":{"role":"assistant","content":[{"type":"text","text":"measured answer"}]},"usage":{"inputTokens":100,"outputTokens":20,"cacheReadTokens":10,"costUsd":0.01}}
{"type":"message","id":"r2","parentId":"r1","timestamp":"2026-09-19T01:00:10Z","model":"deepseek/deepseek-chat","message":{"role":"assistant","content":[{"type":"text","text":"estimated answer"}]}}
"#).unwrap();
        let result = collect(&root, "commandcode", std::slice::from_ref(&root)).unwrap();
        assert_eq!(result.messages.len(), 2);
        assert_eq!(token_basis(&result.messages[0]), "reported");
        assert_eq!(token_basis(&result.messages[1]), "estimated");
        assert_eq!(result.messages[0].tokens.input, 100);
        assert_eq!(result.messages[0].cost_source, CostSource::ProviderReported);
    }

    #[test]
    fn cursor_profile_is_exclusive_and_preserves_account_and_exact_usage() {
        let (_temp, root) = home();
        let legacy = root.join(".config/tokscale/cursor-cache");
        let native = root.join("aicharts/cursor");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&native).unwrap();
        // This must never be read by the exclusive profile.
        fs::write(legacy.join("usage.json"), "{invalid").unwrap();
        fs::write(native.join("usage.account-local.json"), r#"{"usageEventsDisplay":[{"conversationId":"session-1","timestamp":"1789779600000","model":"claude-sonnet-4","tokenUsage":{"inputTokens":10,"outputTokens":5,"cacheReadTokens":2,"cacheWriteTokens":1,"totalCents":0.25}}]}"#).unwrap();
        let result = collect_profile(
            &root,
            "cursor",
            std::slice::from_ref(&native),
            std::slice::from_ref(&native),
        )
        .unwrap();
        assert_eq!(result.messages.len(), 1);
        assert_eq!(result.messages[0].tokens.input, 10);
        assert_eq!(result.messages[0].cost_source, CostSource::ProviderReported);
        assert_eq!(result.messages[0].session_id, "session-1");
        assert_eq!(result.receipt.files, 1);
        assert!(collect_profile(&root, "unknown", std::slice::from_ref(&root), &[native]).is_err());
    }

    #[test]
    fn cost_only_cursor_event_has_no_measured_token_claim() {
        let (_temp, root) = home();
        let native = root.join("cursor");
        fs::create_dir(&native).unwrap();
        fs::write(native.join("usage.account-local.json"), r#"{"usageEventsDisplay":[{"timestamp":"1789779600000","model":"auto","chargedCents":1.25}]}"#).unwrap();
        let result = collect_profile(
            &root,
            "cursor",
            std::slice::from_ref(&native),
            std::slice::from_ref(&native),
        )
        .unwrap();
        assert_eq!(result.messages.len(), 1);
        assert_eq!(token_basis(&result.messages[0]), "unavailable");
        assert_eq!(result.messages[0].cost_source, CostSource::ProviderReported);
        assert!(result.messages[0].session_id.contains("account-local"));
    }

    #[test]
    fn alias_profiles_share_gjc_ownership_and_overlapping_roots_do_not_duplicate() {
        let (_temp, root) = home();
        let source = root.join("custom/project");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("session.jsonl"), r#"{"type":"session","id":"session-1"}
{"type":"message","id":"request-1","message":{"role":"assistant","model":"hf:deepseek/model","provider":"synthetic","source":"9router","timestamp":1789779600000,"usage":{"input":10,"output":5}}}
"#).unwrap();
        let roots = [root.join("custom"), source];
        let owner = collect_profile(&root, "gjc", std::slice::from_ref(&root), &roots).unwrap();
        let alias = collect_profile(&root, "9router", std::slice::from_ref(&root), &roots).unwrap();
        assert_eq!(owner.messages, alias.messages);
        assert_eq!(owner.messages.len(), 1);
        assert!(
            collect_profile(&root, "synthetic", std::slice::from_ref(&root), &roots)
                .unwrap()
                .messages
                .is_empty()
        );
    }

    #[test]
    fn freebuff_shared_tree_is_partitioned_and_companion_settings_are_explicit() {
        let (_temp, root) = home();
        let channel = root.join("custom");
        let source = channel.join("projects/project/chats/2026-09-19T01-00-00.000Z");
        fs::create_dir_all(&source).unwrap();
        fs::write(
            channel.join("settings.json"),
            r#"{"freebuffModel":"deepseek-v3"}"#,
        )
        .unwrap();
        fs::write(source.join("chat-messages.json"), r#"[{"role":"user","content":"test input"},{"role":"assistant","blocks":[{"content":"test output"}],"metadata":{"runState":{"sessionState":{"mainAgentState":{"agentType":"base2-free"}}}}}]"#).unwrap();
        let report = collect_profile(
            &root,
            "freebuff",
            std::slice::from_ref(&root),
            std::slice::from_ref(&channel),
        )
        .unwrap();
        assert_eq!(report.messages.len(), 1);
        assert_eq!(report.messages[0].client, "freebuff");
        assert_eq!(report.messages[0].model_id, "deepseek-v3");
        assert_eq!(token_basis(&report.messages[0]), "estimated");
        assert!(collect_profile(
            &root,
            "codebuff",
            std::slice::from_ref(&root),
            std::slice::from_ref(&channel)
        )
        .unwrap()
        .messages
        .is_empty());
        // A broad approved home does not silently authorize a companion outside
        // the selected profile. Select the channel root to include settings.
        assert!(collect_profile(
            &root,
            "freebuff",
            std::slice::from_ref(&root),
            &[channel.join("projects")]
        )
        .is_err());
    }

    #[test]
    fn multiple_cumulative_databases_require_an_unambiguous_profile() {
        let (_temp, root) = home();
        for path in ["a/sessions.db", "b/sessions.db"] {
            fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
            fs::write(root.join(path), "not a database").unwrap();
        }
        let errors = collect_profile(
            &root,
            "goose",
            std::slice::from_ref(&root),
            std::slice::from_ref(&root),
        )
        .err()
        .unwrap();
        assert!(errors.contains(&"import_profile_store_ambiguous"));
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_source_is_rejected() {
        let (_temp, root) = home();
        let source = root.join(".reasonix/stats");
        fs::create_dir_all(&source).unwrap();
        fs::write(root.join("elsewhere"), "{}\n").unwrap();
        std::os::unix::fs::symlink(root.join("elsewhere"), source.join("2026-09-19.jsonl"))
            .unwrap();
        assert!(collect(&root, "reasonix", std::slice::from_ref(&root)).is_err());
    }
}
