# Grokian

Grokian is a Grok-powered Obsidian writing assistant for story planning,
inline rewrite, and chat-assisted drafting.

## Origin and License

Grokian is based on Claudian by Yishen Tu and keeps the original MIT license.
Please retain the license text when redistributing.

## Scope

- Obsidian Desktop plugin
- Local Grok CLI runtime integration
- Sidebar chat
- Selected text rewrite
- Draft continuation and story-planning commands

## Safety Defaults

- Do not store API keys, OAuth artifacts, cookies, tokens, or credentials.
- Project runtime artifacts are stored under `.grokian/` and should be kept local.
- Generated text is retained as candidates until user accepts it.
