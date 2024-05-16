#!/usr/bin/env bash

solc_default_version="0.8.17"

declare solc_version
declare contracts_path
declare result_path

if [ -z "$1" ]; then
    echo "missing positional argument 1: contracts dir path"
    exit 1
fi

if [ "$2" ]; then
   solc_version=$2
else
   solc_version=$solc_default_version
fi

contracts_path=$1
result_path="$(dirname "$contracts_path")/mythril"

rm -rf "$result_path"/*
mkdir -p "$result_path"

iterate_sources() {
    for filename in "$1"/*.sol; do
        [ -e "$filename" ] || continue

        contract_name=$(basename -- "$filename")
        echo "starting mythril analysis of $contract_name"
        myth analyze --solv "$solc_version" "$filename" > "$2"/"$contract_name" 2>/dev/null &
    done

    wait
}

iterate_sources "$contracts_path" "$result_path"
