#!/bin/sh
# builds the contracts using a real binary solc
# this has only been used for debugging the issues with the ABIEncoder call V2
# it's kept for reference on how to use colc in combination with docker
# since there is no solc package on npm that supports full 
# EVM 
docker run -v contracts:/sources ethereum/solc:0.5.16 -o /sources/output --abi --bin /sources/KeyGenHistory.sol