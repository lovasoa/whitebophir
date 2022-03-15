#!/bin/bash

# Get snapshot from Cisco codec, via RMS proxy
curl --silent -o /dev/null -u avasupport:avasupport -H "Content-Type: application/x-www-form-urlencoded" -d "username=admin&password=avasupport&next=" --cookie-jar cookies.txt -b "rms_proxy_robot=SB00101; rms_proxy_cid=voip-admin" -X POST https://home-proxy.ava8.net/web/signin/open
curl --silent -u mark@avarobotics.com:avacambridge1 --cookie-jar cookies.txt --cookie cookies.txt -b "rms_proxy_robot=SB00101; rms_proxy_cid=voip-admin" https://home-proxy.ava8.net/web/api/snapshot/get