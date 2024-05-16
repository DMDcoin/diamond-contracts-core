#!/usr/bin/env bash

declare contracts_path
declare flat_path

if [ -z "$1" ]; then
    echo "missing positional argument 1: contracts dir path"
    exit 1
fi

contracts_path=$1
flat_path="$(dirname "$contracts_path")/flat"

rm -rf "$flat_path"/*
mkdir -p "$flat_path"

iterate_sources() {
    for filename in "$1"/*.sol; do
        [ -e "$filename" ] || continue

        contract_name=$(basename -- "$filename")
        echo "flatten contract $contract_name"
        npx hardhat flatten "$filename" > "$2"/"$contract_name" 2>/dev/null
    done
}

iterate_sources "$contracts_path" "$flat_path"
