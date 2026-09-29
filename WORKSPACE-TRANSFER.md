# Move workspace data to another computer

In the editor, choose **Move workspace**. The same panel is available under
**Settings → This machine**. Export the workspace data, then download the snapshot.
On the other computer, install the same Agentcut version, open that panel, choose
the snapshot, review its counts and confirm replacement. Reload the workspace
when restoration finishes. Save edits and close other editing tabs before restoring.

A snapshot includes the onboarding answers/profile, preferences, glossary, rules,
templates, installed packs and their resources, shared library, provider and model
selection, saved API/connection credentials, projects, edit lists, history,
conversations, observations, jobs and publishing records. Non-media workspace files
such as transcripts, thumbnails and run metadata also travel with it.

Source recordings, project audio/video files and rendered outputs are excluded;
copy those separately to the same relative workspace locations. Media inside packs
and the shared library is included. The snapshot manifest lists omitted workspace
media. References to external files remain external: copy or relink them separately.
Data owned by other applications, environment variables, installed binaries/models
and external agent CLI login sessions are not included. Sign in to those CLIs on the
new computer. Browser-only view preferences and unsaved drafts are not included.
This is a replica of saved Agentcut workspace data, not a complete disk backup.

Snapshots contain private data and saved keys. They are compressed, **not encrypted**;
keep them private. Exports and uploads are stored under `workspace/exports/snapshots`
with owner-only file permissions. Delete copies manually when no longer needed.

## Terminal and agents

```sh
node scripts/agentcut.mjs workspace export ~/Downloads
node scripts/agentcut.mjs workspace preview /path/to/copy.agentcut.gz
node scripts/agentcut.mjs workspace restore /path/to/copy.agentcut.gz --replace
```

MCP exposes `agentcut_workspace_snapshot_export`,
`agentcut_workspace_snapshot_preview` and `agentcut_workspace_snapshot_restore`.
Restore requires the preview fingerprint and `confirm: "replace-workspace-data"`.
All interfaces call the same validation, export and restore service. Responses
contain file paths and counts, never credential values.

## Restore behavior and format

The version 1 format is gzip-compressed newline-delimited JSON: header, SQLite table
records, base64 file records and a final SHA-256 checksum. Each file also has its own
checksum. Limits are 512 MB compressed, 1 GB expanded, 128 MB per file and 100,000
files. Unsupported tables/versions, unsafe paths, symlinks, truncated data and
checksum errors fail before replacement. Database schema mismatches roll back.

Restore first exports a recovery snapshot of the destination, checks for changes,
stages files and replaces logical files together with a SQLite transaction. A
caught failure restores the previous files and rolls back the database. Keep the
recovery snapshot in case of a process crash or power loss during file replacement;
filesystem renames and SQLite cannot form a crash-atomic transaction. Recovery data
can be downloaded from the result panel or restored from `exports/snapshots`.

This is whole-workspace restoration of stored state, not an editing operation:
EDLs and history retain their saved contents and revisions. Absolute paths under
the previous workspace/app root are rebased in database cells and JSON files.
Other strings and external locations are preserved. Existing excluded media stays
on disk; logical files absent from the snapshot are removed.

Active destination jobs and publishing leases block restoration. Source jobs that
were queued/running become failed and can be restarted explicitly. Interrupted
publication destinations become unknown, active phone sessions stop, delivery
approvals and leases are cleared, and pack recipes must be trusted again. Verify
unknown publication results before retrying them. Existing completed publication
history is preserved.
