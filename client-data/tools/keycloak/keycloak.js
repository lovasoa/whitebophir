/**
 *                        WHITEBOPHIR
 *********************************************************
 * @licstart  The following is the entire license notice for the 
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 */

(function () { //Code isolation
	if (Tools.server_config.KEYCLOAK_ENABLE) {
		var keycloak = Keycloak({
			url: Tools.server_config.KEYCLOAK_URL,
			realm: Tools.server_config.KEYCLOAK_REALM,
			clientId: Tools.server_config.KEYCLOAK_CLIENTID
		  });
	
		keycloak.init({
			onLoad: 'login-required'
		}).catch(function(e) {
			console.log(e);
		});
		
		function onStart() {
			keycloak.logout({
				redirectUri: window.location.href.split("/boards/")[0]
			});	
		}
	
		keycloak.onAuthSuccess = function() { 
			keycloak.loadUserInfo().then(function(userInfo) {
				if (Tools.server_config.KEYCLOAK_USERINFO_ATTRIBUTE) {
					if (!userInfo[Tools.server_config.KEYCLOAK_USERINFO_ATTRIBUTE]) {
						alert("Sitema non disponibile per l'utente " + userInfo.preferred_username);
						keycloak.logout();
					}	
				}
				var avatar = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><circle cx="500" cy="500" r="500" fill="#d32f2f" /><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" letter-spacing="-25" font-size="400" fill="#FFFFFF" font-family="sans-serif">' +
					userInfo.given_name.charAt(0).toUpperCase() + userInfo.family_name.charAt(0).toUpperCase() +
					'</text></svg>';
				Tools.add({ //The new tool
					"name": 'Logout ' + userInfo.given_name + " " + userInfo.family_name,
					"shortcut": "L",
					"onstart": onStart,
					"stylesheet": "tools/keycloak/keycloak.css",
					"icon": "data:image/svg+xml," + encodeURIComponent(avatar)
				});
			}); 
		}	
	}
})(); //End of code isolation
