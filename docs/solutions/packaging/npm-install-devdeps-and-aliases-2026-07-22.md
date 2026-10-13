---
title: npm install quietly omits devDependencies; npm 11 won't alias an existing direct dep
date: 2026-07-22
category: docs/solutions/packaging/
module: build
problem_type: developer_experience
component: npm workspaces, package-lock.json
severity: medium
applies_when:
  - "Cannot find package 'tsx'" (or another devDependency) right after a successful npm install
  - Adding an npm alias for a second version of a package the repo already depends on
  - The workspace node_modules tree looks wrong after an install
tags:
  - npm
  - workspaces
  - devdependencies
  - node-env
---

## devDependencies silently missing

With `NODE_ENV=production` (or npm `omit=dev`) set in the shell, a plain `npm install` **omits
devDependencies** and still reports success. `npm test -w server` then fails with
`Cannot find package 'tsx'`, even though tsx is in `server/package.json` and the lockfile. Regular
dependencies still install, which makes the symptom look selective.

Fix: `npm install --include=dev`. For local packaging:
`NODE_ENV=development npm_config_omit= npm run package:mac`.

## npm 11 won't materialize an alias to a direct dependency

`"headless55": "npm:@xterm/headless@5.5.0"` is written to package.json but never appears in
`node_modules` when `@xterm/headless@^6` is also a direct dependency: npm dedups it. Tarball-URL aliases
don't get around this. Tests that need the second version must skip when it doesn't resolve.

## Don't use `--workspaces=false`

It prunes workspace devDeps from the hoisted tree and corrupts it. To recover a broken tree:
`rm -rf node_modules */node_modules package-lock.json && npm install --include=dev`, then review the
lockfile diff before committing.
