//! Old layouts are synthesized from their exact retained DDL, not live state.
use super::*;

fn image(connection: &Connection) -> Vec<(String, Vec<Vec<rusqlite::types::Value>>)> {
    let mut tables = connection
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
        .unwrap();
    let names = tables
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    names
        .into_iter()
        .map(|table| {
            let mut statement = connection
                .prepare(&format!("SELECT * FROM {table} ORDER BY 1"))
                .unwrap();
            let columns = statement.column_count();
            let rows = statement
                .query_map([], |row| {
                    (0..columns)
                        .map(|i| row.get(i))
                        .collect::<rusqlite::Result<Vec<_>>>()
                })
                .unwrap()
                .collect::<std::result::Result<Vec<_>, _>>()
                .unwrap();
            (table, rows)
        })
        .collect()
}
fn downgrade_fixture(f: &Fixture) {
    let mut connection = f.raw();
    let version = storage::schema_version(&connection).unwrap();
    let tx = connection.transaction().unwrap();
    let sources = {
        let mut statement = tx.prepare("SELECT id,stamp,warnings FROM sources").unwrap();
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap()
    };
    tx.execute_batch("DROP TABLE sources").unwrap();
    tx.execute_batch(storage::LEGACY_TABLES[1].1).unwrap();
    for (id, stamp, warnings) in sources {
        tx.execute(
            "INSERT INTO sources VALUES(?1,?2,?3)",
            params![id, stamp, warnings],
        )
        .unwrap();
    }
    tx.pragma_update(None, "user_version", version - 4).unwrap();
    tx.commit().unwrap();
}
#[test]
fn all_legacy_layouts_upgrade_only_with_exact_validated_backup_and_preserve_every_row() {
    for (sender, prefix) in [(false, false), (true, false), (false, true), (true, true)] {
        let (f, mut ledger) = setup(3, sender);
        if prefix {
            drop(ledger);
            ledger = Ledger::migrate_complete_prefix(&f.dir(), &identity(), 1).unwrap();
        }
        if sender {
            let settled = ledger.freeze_upload_batch(1, &[id(1)]).unwrap();
            ledger
                .settle_upload_batch(&journal(&settled, &[wire::Outcome::Inserted]))
                .unwrap();
            ledger
                .freeze_upload_batch(ledger.snapshot().unwrap().revision, &[id(2)])
                .unwrap();
        }
        let revision = ledger.snapshot().unwrap().revision;
        drop(ledger);
        downgrade_fixture(&f);
        let before = fs::read(f.database()).unwrap();
        let rows = image(&f.raw());
        let version = storage::schema_version(&f.raw()).unwrap();
        let view = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
        assert_eq!(view.history_audit().disposition(), "upgrade_required");
        assert_eq!(
            Ledger::open_with_identity(&f.dir(), &identity()).err(),
            Some(Error::UpgradeRequired)
        );
        let wrong = f.0.join("wrong-revision");
        assert_eq!(
            Ledger::upgrade(&f.dir(), &identity(), 0, &wrong).err(),
            Some(Error::StaleRevision)
        );
        assert!(!wrong.exists());
        let rollback_backup = f.0.join("rollback-backup");
        assert_eq!(
            Ledger::upgrade_with(&f.dir(), &identity(), revision, &rollback_backup, || Err(
                Error::Storage
            ))
            .err(),
            Some(Error::Storage)
        );
        assert_eq!(
            fs::read(rollback_backup.join("usage.sqlite3")).unwrap(),
            before
        );
        assert_eq!(image(&f.raw()), rows);
        assert_eq!(storage::schema_version(&f.raw()).unwrap(), version);
        let backup = f.0.join("backup");
        let outcome = Ledger::upgrade(&f.dir(), &identity(), revision, &backup).unwrap();
        assert!(outcome.changed);
        let upgraded = outcome.ledger;
        assert_eq!(
            storage::schema_version(&upgraded.connection).unwrap(),
            version + 4
        );
        assert_eq!(image(&upgraded.connection), rows);
        assert_eq!(fs::read(backup.join("usage.sqlite3")).unwrap(), before);
        assert_eq!(upgraded.status().unwrap().revision, revision);
        drop(upgraded);
        assert_eq!(
            ReadOnlyLedger::open(&f.dir(), &identity())
                .unwrap()
                .history_audit()
                .disposition(),
            "current"
        );
        assert_eq!(
            ReadOnlyLedger::open(&backup, &identity())
                .unwrap()
                .history_audit()
                .schema_version,
            version
        );
    }
}
#[test]
fn both_historical_owner_orders_are_readable_exportable_but_quarantined_without_rewriting() {
    for retained_owner in [9, 10] {
        let (f, ledger) = setup(1, false);
        drop(ledger);
        downgrade_fixture(&f);
        let mut other = record(1, 10);
        other.execution_id = [10; 16];
        let connection = f.raw();
        connection
            .execute(
                "INSERT INTO sources VALUES(?1,?2,0)",
                params![[2u8; 32].as_slice(), stamp(100).encode().unwrap()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO source_usage VALUES(?1,?2,?3)",
                params![[2u8; 32].as_slice(), id(1).as_slice(), frame(other.clone())],
            )
            .unwrap();
        other.execution_id = [retained_owner; 16];
        for table in ["measurements", "outbox"] {
            connection
                .execute(
                    &format!("UPDATE {table} SET frame=?1"),
                    [frame(other.clone())],
                )
                .unwrap();
        }
        drop(connection);
        let before = fs::read(f.database()).unwrap();
        let view = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
        assert_eq!(view.history_audit().attribution_conflicts, 1);
        assert_eq!(view.status().tokens, 130);
        assert_eq!(view.inventory()[0].frame, frame(other));
        let copy = f.0.join("export");
        view.export_to(&copy, &identity()).unwrap();
        assert_eq!(fs::read(copy.join("usage.sqlite3")).unwrap(), before);
        assert_eq!(
            Ledger::open_with_identity(&f.dir(), &identity()).err(),
            Some(Error::AttributionQuarantined)
        );
        let upgrade = f.0.join("upgrade");
        assert_eq!(
            Ledger::upgrade(&f.dir(), &identity(), 1, &upgrade).err(),
            Some(Error::AttributionQuarantined)
        );
        assert!(!upgrade.exists());
        assert_eq!(fs::read(f.database()).unwrap(), before);
        // Diagnostic attribution tolerance cannot excuse numeric corruption.
        let mut wrong = record(1, 11);
        wrong.execution_id = [retained_owner; 16];
        let connection = f.raw();
        for table in ["measurements", "outbox"] {
            connection
                .execute(
                    &format!("UPDATE {table} SET frame=?1"),
                    [frame(wrong.clone())],
                )
                .unwrap();
        }
        assert_eq!(
            ReadOnlyLedger::open(&f.dir(), &identity()).err(),
            Some(Error::InvalidState)
        );
    }
}
#[test]
fn every_persisted_warning_round_trips_and_old_bits_keep_their_meaning() {
    for (bit, warning) in WARNINGS.into_iter().enumerate() {
        assert_eq!(warning_bit(warning), 1 << bit);
        assert_eq!(warnings(1 << bit).unwrap(), vec![warning]);
    }
    assert_eq!(warning_mask(&[Warning::NoUsageMeasurements]), 0);
    assert_eq!(
        warnings(1 << WARNINGS.len()).err(),
        Some(Error::InvalidState)
    );
    let f = Fixture::new();
    let mut ledger = f.initialize();
    let mut source = scan(1, 100, vec![usage(1, 10)]);
    source.collection.warnings = WARNINGS.to_vec();
    ledger.commit_scans(0, vec![source]).unwrap();
    drop(ledger);
    let mut expected = WARNINGS.to_vec();
    expected.sort_unstable();
    assert_eq!(f.open().status().unwrap().warnings, expected);
}

fn numeric_history(sender: bool, prefix: bool, reverse: bool) -> Fixture {
    let (f, mut ledger) = setup(1, sender);
    if prefix {
        drop(ledger);
        ledger = Ledger::migrate_complete_prefix(&f.dir(), &identity(), 1).unwrap();
    }
    if sender {
        ledger.freeze_upload_batch(1, &[id(1)]).unwrap();
    }
    drop(ledger);
    downgrade_fixture(&f);
    let connection = f.raw();
    // Retain the previously admitted dominant C under the last source id.
    connection
        .execute("UPDATE sources SET id=?1", [[3u8; 32].as_slice()])
        .unwrap();
    connection
        .execute(
            "UPDATE source_usage SET source_id=?1",
            [[3u8; 32].as_slice()],
        )
        .unwrap();
    if prefix {
        connection
            .execute(
                "UPDATE source_prefixes SET source_id=?1",
                [[3u8; 32].as_slice()],
            )
            .unwrap();
    }
    let mut a = record(1, 1);
    let mut b = record(1, 10);
    b.tokens.input_uncached = 1;
    if reverse {
        std::mem::swap(&mut a, &mut b);
    }
    for (source, record) in [(1u8, a), (2, b)] {
        connection
            .execute(
                "INSERT INTO sources VALUES(?1,?2,0)",
                params![[source; 32].as_slice(), stamp(100).encode().unwrap()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO source_usage VALUES(?1,?2,?3)",
                params![[source; 32].as_slice(), id(1).as_slice(), frame(record)],
            )
            .unwrap();
        if prefix {
            connection
                .execute(
                    "INSERT INTO source_prefixes VALUES(?1,NULL,NULL,NULL)",
                    [[source; 32].as_slice()],
                )
                .unwrap();
        }
    }
    f
}
#[test]
fn historical_numeric_replay_conflicts_are_exact_exportable_quarantine_in_all_layouts_and_orders() {
    for (sender, prefix) in [(false, false), (true, false), (false, true), (true, true)] {
        for reverse in [false, true] {
            let f = numeric_history(sender, prefix, reverse);
            let before = fs::read(f.database()).unwrap();
            let rows = image(&f.raw());
            let view = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
            assert_eq!(view.history_audit().numeric_replay_conflicts, 1);
            assert_eq!(view.history_audit().attribution_conflicts, 0);
            assert_eq!(
                view.history_audit().disposition(),
                "numeric_replay_quarantined"
            );
            assert_eq!(view.inventory()[0].frame, frame(record(1, 10)));
            assert_eq!(view.status().tokens, 130);
            let copy = f.0.join("export");
            view.export_to(&copy, &identity()).unwrap();
            assert_eq!(fs::read(copy.join("usage.sqlite3")).unwrap(), before);
            assert_eq!(
                ReadOnlyLedger::open(&copy, &identity())
                    .unwrap()
                    .history_audit(),
                view.history_audit()
            );
            assert_eq!(
                Ledger::open_with_identity(&f.dir(), &identity()).err(),
                Some(Error::NumericReplayQuarantined)
            );
            assert_eq!(
                Ledger::upgrade(
                    &f.dir(),
                    &identity(),
                    view.snapshot().revision,
                    &f.0.join("refused")
                )
                .err(),
                Some(Error::NumericReplayQuarantined)
            );
            assert!(!f.0.join("refused").exists());
            assert_eq!(fs::read(f.database()).unwrap(), before);
            assert_eq!(image(&f.raw()), rows);
        }
    }
}
#[test]
fn historical_numeric_quarantine_never_invents_maxima_or_waives_context_or_dominance() {
    for invalid in ["unretained_maximum", "not_dominant", "different_context"] {
        let f = numeric_history(false, false, false);
        let connection = f.raw();
        if invalid == "different_context" {
            let mut source = record(1, 10);
            source.tokens.input_uncached = 1;
            source.provider = Provider::Devin;
            connection
                .execute(
                    "UPDATE source_usage SET frame=?1 WHERE source_id=?2",
                    params![frame(source), [2u8; 32].as_slice()],
                )
                .unwrap();
        } else {
            let mut candidate = record(1, 1);
            if invalid == "unretained_maximum" {
                candidate.tokens.input_uncached = 101;
                candidate.tokens.output = 11;
            }
            for table in ["measurements", "outbox"] {
                connection
                    .execute(
                        &format!("UPDATE {table} SET frame=?1"),
                        [frame(candidate.clone())],
                    )
                    .unwrap();
            }
        }
        assert_eq!(
            ReadOnlyLedger::open(&f.dir(), &identity()).err(),
            Some(Error::InvalidState),
            "{invalid}"
        );
    }
}

#[test]
fn combined_historical_numeric_and_owner_conflicts_preserve_independently_retained_evidence() {
    for prefix in [false, true] {
        let f = numeric_history(false, prefix, false);
        let connection = f.raw();
        let mut b = record(1, 10);
        b.tokens.input_uncached = 1;
        b.execution_id = [10; 16];
        connection
            .execute(
                "UPDATE source_usage SET frame=?1 WHERE source_id=?2",
                params![frame(b), [2u8; 32].as_slice()],
            )
            .unwrap();
        let mut materialized = record(1, 10);
        materialized.execution_id = [10; 16];
        for table in ["measurements", "outbox"] {
            connection
                .execute(
                    &format!("UPDATE {table} SET frame=?1"),
                    [frame(materialized.clone())],
                )
                .unwrap();
        }
        drop(connection);
        let before = fs::read(f.database()).unwrap();
        let view = ReadOnlyLedger::open(&f.dir(), &identity()).unwrap();
        assert_eq!(view.history_audit().attribution_conflicts, 1);
        assert_eq!(view.history_audit().numeric_replay_conflicts, 1);
        assert_eq!(view.inventory()[0].frame, frame(materialized));
        view.export_to(&f.0.join("export"), &identity()).unwrap();
        assert_eq!(fs::read(f.0.join("export/usage.sqlite3")).unwrap(), before);
        assert_eq!(
            Ledger::upgrade(
                &f.dir(),
                &identity(),
                view.snapshot().revision,
                &f.0.join("refused")
            )
            .err(),
            Some(Error::AttributionQuarantined)
        );
        assert_eq!(fs::read(f.database()).unwrap(), before);
    }
}
