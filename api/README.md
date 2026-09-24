# API

The domain vocabulary and every contract a plugin implements.

What a film is, what a profile is, what watch progress means, what a plugin must
provide to serve content or carry state.

## It depends on nothing

Not React, not Expo, not the app, not a plugin. That is what lets the app and a
dozen plugins agree without any of them knowing about each other.

The app depends on this. Every plugin depends on this. The sync server depends
on this for its wire types. It is the centre of the whole project, and it must
stay a leaf.

## Status

Placeholder. Nothing implemented yet — the contracts are specified in
`../../.claude/streaming-center-architecture.md` but not written as code.

**This comes first.** Nothing else can be built correctly until the vocabulary
exists.
