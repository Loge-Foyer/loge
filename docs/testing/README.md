# Testing

Fakes, the conformance suite every plugin should pass, and running the test suite.

The `mock` plugin carries both roles so media *and* sync can be exercised end to end without a real server. Tests should flip its toggles to confirm the app honours effective capabilities rather than declared ones.
