#!/usr/bin/env bash

set -eu
set -o pipefail

source .env

STAKING_HBBFT_IMPL_ADDRESS="0x6642c3A24adc17c91d0df9Ab6Cd51880521ACfE0"
STAKING_HBBFT="StakingHbbft"

OUTPUT=$(forge create \
    contracts/${STAKING_HBBFT}.sol:${STAKING_HBBFT} \
    --rpc-url ${FORKED_NETWORK_RPC_URL} \
    --private-key ${FORK_SIGNER_PRIVATE_KEY} \
    --broadcast \
    --json)

STAKING_HBBFT_NEW_ADDRESS=$(echo "$OUTPUT" | jq -r '.deployedTo')

cast rpc \
    --quiet \
    anvil_setCode ${STAKING_HBBFT_IMPL_ADDRESS} "$(cast code ${STAKING_HBBFT_NEW_ADDRESS} --rpc-url ${FORKED_NETWORK_RPC_URL})" \
    --rpc-url ${FORKED_NETWORK_RPC_URL}
