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
						alert(Tools.i18n.t("access_denied" || "") + userInfo.preferred_username);
						keycloak.logout();
					}	
				}
				Tools.add({ //The new tool
					"name": Tools.i18n.t("logout" || "") + userInfo.given_name + " " + userInfo.family_name,
					"shortcut": "L",
					"onstart": onStart,
					"stylesheet": "tools/keycloak/keycloak.css",
					"icon": "tools/keycloak/icon.svg"
				});
			}); 
		}	
	}
})(); //End of code isolation
