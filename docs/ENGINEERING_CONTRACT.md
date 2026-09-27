# Survivor Engineering Contract

## Production boundary
The Cloudflare Worker is the only autonomous production cycle runner. The browser must not create a second autonomous production loop in live mode.

## Source of truth
Production business state comes from D1 through the Worker. The dashboard must not substitute sample/local business state when production is unreachable.

## Evidence before action
Discovery results must be verified before becoming actionable prospects. Customer-facing personalization must not trust low-confidence or unsynthesized research.

## Money boundaries
- Simulated experiments and real revenue are separate ledgers.
- Sandbox payment events cannot become real revenue.
- Real revenue recording requires operator authentication.
- Real-money treasury execution remains disabled.
- Learning from revenue requires independent verification.

## Cost boundaries
Automatic search/LLM activity is governed by the cost meter and search-economy controls. Manual operator research is separately accounted for.

## Database boundary
Production schema changes are explicit migrations. Application deployment does not silently execute production SQL. The Worker health endpoint must report required-table readiness; schema failure is a production failure, not a reason to use sample data.

## Completion definition
A feature is complete only when:
1. the implementation exists;
2. production paths use it;
3. failure behaviour is explicit;
4. a regression test or production guard covers the boundary;
5. deployment/runtime behaviour is verified;
6. documentation reflects the current state.

## Change discipline
Prefer small additive changes. Reuse existing domain models and repository abstractions instead of creating parallel subsystems. New migrations, providers, payment paths and autonomous actions must add their production-boundary check at the same time.
