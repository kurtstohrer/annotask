# upstream-adapters

Adapters that wrap external data sources with a live-plus-snapshot
pattern: try the live fetch, fall back to a pinned snapshot from
`source-snapshots/` on any failure.

Annotask's data-source discovery should surface both the live URL and
the local snapshot as linked sources.
