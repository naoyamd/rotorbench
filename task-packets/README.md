# Task packets

Each future benchmark is defined as a versioned, immutable task packet. A
packet contains the engineering brief, every input file, the required output
roles, the common environment declaration, and completion criteria. File
hashes make the packet independently verifiable.

Only `_template/` is checked in today. It is structural documentation, not an
engineering task and is excluded from the public catalog.
