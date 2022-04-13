#!/bin/bash

RMS=eft
ROBOT=SB00243

# Get snapshot from Cisco codec, via RMS proxy
# TODO if we ever use this again, we should be smart about not opening
# TODO a new login session every time because that causes the codec
# TODO to respond with a "too many sessions" error
#curl --silent -o /dev/null -u avasupport:avasupport -H "Content-Type: application/x-www-form-urlencoded" -d "username=admin&password=avasupport&next=" --cookie-jar cookies.txt -b "rms_proxy_robot=SB00243; rms_proxy_cid=voip-admin" -X POST https://eft-proxy.ava8.net/web/signin/open
#curl --silent -u avasupport:avasupport --cookie-jar cookies.txt --cookie cookies.txt -b "rms_proxy_robot=SB00243; rms_proxy_cid=voip-admin" https://eft-proxy.ava8.net/web/api/snapshot/get

curl --silent -o /dev/null -u avasupport:avasupport https://$RMS.ava8.net/api/htproxy/whiteboard/$ROBOT/robot/cameraPose/sendCommand?value=149
sleep 0.3
curl --silent -u avasupport:avasupport https://$RMS.ava8.net/api/htproxy/whiteboard/$ROBOT/images/snapshot.jpg