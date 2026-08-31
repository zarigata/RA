# Deny a file read that follows a symlink outside the project

Scenario: `18-symlink-boundary`.

Run the installed executable through the terminal acceptance driver:

```sh
sandbox-exec -f /private/tmp/ra-user-sandbox/policy.sb \
  python3 /private/tmp/ra-user-sandbox/terminal_acceptance.py --only 18-symlink-boundary
```

The driver creates a fresh isolated project and HOME, records terminal commands and output, and asserts the relevant behavior. See `../terminal_acceptance.py` for the exact user prompts and independent checks, and `../evidence/final/18-symlink-boundary.json` for the final transcript. Export the cloud key privately when the case requires it. No repository test script or internal RA module is called.
