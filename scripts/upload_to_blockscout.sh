#!/bin/bash


export contractSourceRaw=$(cat ../build/flattened/ValidatorSetHbbft.sol)
export contractName="ValidatorSetHbbft"
export optimizer="true"
export optimizerRuns="200"


#echo $contractSourceRaw

echo "url encode the source..."

export $contractSource="$(perl -MURI::Escape -e 'print uri_escape($ARGV[0]);' "$contractSourceRaw")"
#echo $contractSource

echo "exporting..."
curl -d '{"addressHash":"0x1000000000000000000000000000000000000001","compilerVersion":"v0.5.16+commit.9c3226ce", "contractSourceCode":"'$contractSource'","name":"$contractName","optimization":"true", "optimizationRuns": "200"}' -H "Content-Type: application/json" -X POST "http://127.0.0.1:4000/api?module=contract&action=verify"

