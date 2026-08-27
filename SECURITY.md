# Security Policy

## Supported versions

Until the first stable release, security fixes are applied to the latest release
and the default branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository.
Do not include secrets, private repository contents, or exploit details in a
public issue.

Include the affected version, a minimal reproduction, expected impact, and any
suggested mitigation. You can expect an acknowledgement within seven days.

## Security design

AgentGuide Lint is intended to be safe on untrusted repositories:

- It does not execute commands discovered in instruction or project files.
- It does not follow paths outside the selected repository root.
- It does not send repository content over the network.
- Its output should be treated as untrusted text in downstream automation.

Security fixes take priority over feature work.
