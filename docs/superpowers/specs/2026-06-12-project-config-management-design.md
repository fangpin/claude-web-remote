# Project Configuration Management Design

## Goal

Add a Web UI flow for viewing and editing the daemon configuration file. The first version manages the existing daemon configuration fields and writes a normalized TOML file. Saved changes take effect after the user manually restarts the daemon.

## Scope

The managed fields are:

- `bind`
- `data_dir`
- `launcher`
- `web_dir`
- `default_permission_mode`

The feature does not add per-repository project profiles, automatic daemon restart, raw TOML editing, diff preview, or preservation of comments and unknown fields.

## Backend API

Add a configuration management API under `/api/config`.

`GET /api/config` returns:

- `path`: the target config file path.
- `exists`: whether the file currently exists.
- `current`: the resolved configuration used by the running daemon.
- `file`: the editable file configuration. If the file does not exist, this is initialized from the current resolved configuration.
- `restartRequired`: `false`.

`PUT /api/config` accepts:

- `bind`: socket address string, such as `127.0.0.1:8787`.
- `dataDir`: path string.
- `launcher`: non-empty argv array.
- `webDir`: optional path string.
- `defaultPermissionMode`: string.

The handler validates the request, creates the parent directory if needed, and rewrites the target file as normalized TOML containing only the supported fields. It returns the updated file configuration and `restartRequired: true`.

The target path is the explicit `--config` path when provided. Otherwise it is the default `~/.claude-remote-web/config.toml` path.

## Runtime Behavior

The daemon keeps using the configuration resolved at startup. Saving through the API does not mutate the running listener, static web directory, launcher prefix, data directory, or default permission mode. The UI and API explicitly report that a manual daemon restart is required before changes take effect.

If the config file is missing, `GET /api/config` still succeeds with editable defaults. The first successful save creates the default config file.

## Frontend UI

Add a lightweight view switch in the existing app for `Sessions` and `Config`. `Sessions` remains the default view.

The `Config` view loads `GET /api/config`, displays the target config path, and shows a restart notice. The form contains:

- `bind`: text input.
- `dataDir`: text input.
- `launcher`: multiline input with one argv element per line.
- `webDir`: text input that may be empty.
- `defaultPermissionMode`: select with `acceptEdits`, `auto`, and `default`.

The frontend validates that `launcher` has at least one non-empty line. Other validation errors are surfaced from the backend. On successful save, the UI shows that the config was saved and the daemon must be restarted manually.

## Error Handling

Backend validation errors return existing API error responses. Required validation includes invalid `bind` values and empty `launcher` arrays. File write failures return a server error message through the same API error path used by other handlers.

Frontend failures are shown in the existing alert style. A failed save leaves the form values unchanged so the user can correct and retry.

## Testing

Backend tests cover:

- Default target path when no explicit config is provided.
- `GET /api/config` for existing and missing config files.
- `PUT /api/config` writing normalized TOML.
- Rejection of invalid `bind` values.
- Rejection of empty `launcher` arrays.

Frontend tests cover:

- Opening the config view and rendering loaded values.
- Editing fields and sending the expected API payload.
- Showing the restart-required success message after save.
- Showing API errors on failed save.

Verification commands:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
cargo test --manifest-path Cargo.toml
npm --prefix web test
npm --prefix web run build
```
