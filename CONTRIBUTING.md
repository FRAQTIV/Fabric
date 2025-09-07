# Contributing Workflow (MCP-Guided)

This repository follows an MCP-guided Git workflow. Before performing Git actions, consult MCP suggestions when available to ensure compliance.

## Feature Development Checklist

- [ ] Consult MCP for suggested workflow for starting a feature (start_feature)
- [ ] Ensure you are on the integration branch: `dev`
- [ ] Pull latest changes: `git pull origin dev`
- [ ] Create a feature branch: `git checkout -b feature/<short-kebab-description>`
- [ ] Make your changes
- [ ] Stage changes: `git add -A`
- [ ] Commit with a valid message format: `type: subject`
  - Allowed types: `feat, fix, docs, style, refactor, test, chore`
  - Example: `feat: add AI business model validation pattern`
- [ ] Push the feature branch: `git push -u origin feature/<short-kebab-description>`
- [ ] Open a PR from feature -> dev

## Merging Features

- [ ] Ensure PR approvals and checks pass
- [ ] Merge feature branch into `dev`
- [ ] Delete the feature branch after merge

## Protected Branches

- Direct commits to `main` are not allowed (local hooks may block)
- The integration branch is `dev`

## Hooks

- `commit-msg` validates commit messages as: `^(feat|fix|docs|style|refactor|test|chore): .+`
- Keep hooks POSIX sh-compatible

## Helper Scripts

- `bin/feature <short-kebab-description>`: Automates start_feature flow

## Notes

- Keep working tree clean (stage/commit or stash before switching branches)
- Prefer small, focused commits and PRs
- Use MCP tools to validate planned actions when available

