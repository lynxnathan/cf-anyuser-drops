# Security policy

Please report vulnerabilities through GitHub's private security-advisory flow.
Do not open a public issue containing credentials, private drop URLs, or an
unpatched exploit.

Upload tokens grant permission to create and delete files. Treat them like
passwords: keep config files private, do not commit them, and rotate a token
with `wrangler secret put UPLOAD_TOKEN` if it may have leaked.

Generated file URLs are public bearer links. They are deliberately difficult
to guess, but anyone who receives one can download its file.
