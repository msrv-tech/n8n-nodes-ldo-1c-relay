const { copyFileSync } = require('node:fs');

// The CLI copies icons, but the codex sidecar must also ship with the node.
copyFileSync('nodes/Ldo1cRelay/Ldo1cRelay.node.json', 'dist/nodes/Ldo1cRelay/Ldo1cRelay.node.json');

copyFileSync('nodes/Ldo1cQueueTrigger/Ldo1cQueueTrigger.node.json', 'dist/nodes/Ldo1cQueueTrigger/Ldo1cQueueTrigger.node.json');
