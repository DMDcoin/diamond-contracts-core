#!/usr/bin/env bash

set -eu
set -o pipefail

source .env

anvil --fork-url ${FORK_RPC_URL} --base-fee 0 --gas-price 0 --code-size-limit 100000000
