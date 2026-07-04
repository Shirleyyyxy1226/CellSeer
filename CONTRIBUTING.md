# Contributing to CellSeer

CellSeer grew out of an Imperial College London MEng Design Engineering thesis
and is now maintained as an open project. Contributions, bug reports, and
questions are all welcome.

## Reporting bugs and requesting features

Please open an issue on GitHub:
<https://github.com/Shirleyyyxy1226/CellSeer/issues>

- **Bugs:** include your OS, how you ran the app (local dev or Docker), the
  steps to reproduce, what you expected, and what happened. Console/terminal
  output and a minimal sample file help a lot.
- **Features:** describe the use case first ("I'm trying to …"), then the
  proposed behaviour.

## Asking for help

Open a GitHub issue with the `question` label, or email the maintainer at
sx822@ic.ac.uk.

## Development setup

See the [README](README.md#getting-started) for the local development
environment (PostgreSQL + FastAPI backend + Vite frontend) and
[DEPLOY.md](DEPLOY.md) for production deployment.

## Running the tests

```bash
# Frontend (Vitest)
cd frontend && npm run test

# cellseer library (pytest)
pip install -e "cellseer[test]" && python -m pytest cellseer/tests -q

# Backend (run from the backend/ directory)
cd backend && python -m pytest tests -q
```

Please make sure the frontend type-check passes before opening a PR:

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit
```

## Pull requests

1. Fork and branch from `main` (use a descriptive branch name).
2. Keep changes focused; add or update tests for behaviour changes.
3. Follow the existing code style — the backend keeps routers thin and logic in
   `compute`/`masterplot`; the frontend keeps Plotly figure builders
   framework-free in `src/charts/`.
4. Ensure tests and the type-check pass, then open a PR describing the change
   and its motivation.

## Code of conduct

Be respectful and constructive. Assume good faith, and keep discussion focused
on the work.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE) that covers this project.
