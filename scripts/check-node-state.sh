#!/bin/bash



# 0x60e5c520000000000000000000000000f8a7d150d9290a665792f9af15d17df477bacb9e
availableSince=$(curl -s --data '{"method":"eth_call","params":[{"from":"0x407d73d8a49eeb85d32cf465507dd71d507100c1","to":"0x1000000000000000000000000000000000000001","data":"0x60e5c520000000000000000000000000f8a7d150d9290a665792f9af15d17df477bacb9e"}],"id":1,"jsonrpc":"2.0"}' -H "Content-Type: application/json" -X POST localhost:8540)


# if availaible since contains zero, then we know that we are not available.

if [[ $availableSince == *"0x0000000000000000000000000000000000000000000000000000000000000000"* ]]; then
  echo "we need to restart!"
fi