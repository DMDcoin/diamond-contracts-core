
// uploads smart contract source code to a blockscout instance.

//curl -d '{"addressHash":"0xc63BB6555C90846afACaC08A0F0Aa5caFCB382a1","compilerVersion":"v0.5.4+commit.9549d8ff", "contractSourceCode":"pragma solidity ^0.5.4; contract Test { }","name":"Test","optimization":false}' -H "Content-Type: application/json" -X POST "https://blockscout.com/poa/sokol/api?module=contract&action=verify"