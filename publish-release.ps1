$ghPath = "$env:USERPROFILE\AppData\Local\Programs\gh\gh.exe"
$token = & $ghPath auth token
$env:GH_TOKEN = $token
Set-Location 'c:\Users\DiaTech\Projects\DocHub\development\dochub-app'
npx electron-builder --publish always '-c.publish.releaseType=release'
