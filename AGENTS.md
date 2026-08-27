# Streetlight repository instructions

Treat [PRODUCT.md](PRODUCT.md) as the authority for product behavior. Read it before planning or changing behavior. If code or older design documents conflict with it, follow `PRODUCT.md`; change it only after Ben approves a product decision.

Read [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) before implementation. For a numbered phase, verify its dependencies, work only on that phase, update its status and evidence, run its listed checks, and stop at the human-review checkpoint. Begin the next phase only after Ben approves the current one.

The canonical application is the root [web](web) directory. The `Existing repository status` section in `PRODUCT.md` describes the pre-Phase 1 scaffold and is historical, not a description of the current code. Use [README.md](README.md) and the root `package.json` for the current architecture and commands.

Read [ENVIRONMENTS.md](ENVIRONMENTS.md) before changing authentication, maps, the Overture importer, environment variables, deployment, or recovery. Automated tests must not create live WorkOS organizations or send invitations.

Keep Streetlight deterministic and AI-free. Add no product scope, data providers, deployment services, abstractions, or compatibility layers for hypothetical needs. Prefer the smallest tested solution that satisfies the current product rules.
