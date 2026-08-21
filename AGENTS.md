# Streetlight repository instructions

Read [PRODUCT.md](PRODUCT.md) before planning or changing product behavior. Treat it as the product authority.

Read [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) before implementation work. If the user requests a numbered phase, verify its dependencies, work only on that phase, update its status and evidence, and stop at the human-review checkpoint.

The existing `web` and `api` directories are an abandoned scaffold, not a specification. Their frameworks, authentication code, deployment files, and repository layout may be replaced.

Keep Streetlight deterministic and AI-free. Do not add product scope, providers, abstractions, or compatibility layers for hypothetical future needs.

Apartment support is implemented but intentionally disabled for the MVP. Preserve its code, data, migrations, and tests; do not re-enable it without a founder decision. See [docs/APARTMENTS_MVP_DEFERRAL.md](docs/APARTMENTS_MVP_DEFERRAL.md).

If code conflicts with `PRODUCT.md`, change the code. Change `PRODUCT.md` only after an explicit founder decision.
