# Security notes

Gitea is the sole project repository. Private-report links have been removed at the owner's
request; no replacement reporting service or response guarantee is advertised. Do not post
tokens, provider credentials, full credential-bearing playlist URLs or pairing secrets in public
issues, logs or screenshots. See [release credential handling](docs/release-security.md).

## What is worth reporting

Three parts of this application take input from strangers, and they are where a real problem is most
likely to be.

**The playlist parser**, `src/services/m3u.ts`, reads text fetched over the network from an address
the viewer supplies, and it is deliberately tolerant of malformed files because public playlists are
routinely broken. Anything that turns a hostile playlist into something worse than a wrong channel
name matters.

**The compatibility repair**, `src/services/repair.ts` with `wasm/manifest-socket.c`, opens a
listening TCP socket on the television's loopback address while it is serving a corrected playlist
to the set's own player. It binds to `127.0.0.1` only and never to a routable address, it holds one
manifest in a fixed 64KB buffer, and it refuses anything larger rather than truncating it. A way to
reach that socket from off the device, or to get more than 64KB into it, would be serious. It is off
by default and only runs when the viewer turns compatibility mode on.

**Channel artwork**, `src/services/logos.ts`, fetches and decodes images from addresses a playlist
supplies.

## What is not a vulnerability here

A playlist that points at something illegal is not a fault in the player, which is a question of
what you feed it rather than of how it behaves. The application ships no channels, contacts no
service of its own, and sends no analytics anywhere: if you find it talking to a host that is not the
playlist, a stream or a logo from that playlist, that **is** worth reporting, because it should not
be possible.

## Which versions

Track fixes against `main` and the active remediation branches in Gitea. The owner's confirmed
working TV baseline is v3.0.0 (with recovery baseline v2.1.0). Release and hardware status
are recorded in the [implementation checklist](docs/IMPLEMENTATION-CHECKLIST.md).
