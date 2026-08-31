# Reject invalid invocation and non-terminal interactive mode

Scenario: `17-cli-errors`.

Run the installed executable through the terminal acceptance driver:

```sh
sandbox-exec -f /private/tmp/ra-user-sandbox/policy.sb \
  python3 /private/tmp/ra-user-sandbox/terminal_acceptance.py --only 17-cli-errors
```

The driver creates a fresh isolated project and HOME, records terminal commands and output, and asserts the relevant behavior. See `../terminal_acceptance.py` for the exact user prompts and independent checks, and `../evidence/final/17-cli-errors.json` for the final transcript. Export the cloud key privately when the case requires it. No repository test script or internal RA module is called.
