# Liftup LAN -botti

Discord-botti Liftup LANeille: turnaustiimien roolit automaattisesti, ilmoitukset (serverien IP:t yms.), Minecraft-integraatio, valvonta – ja kaikki hallittavissa web-paneelista.

- **Node.js 22**, discord.js v14, Express. Ei tietokantaa: tila tallentuu `data/db.json`-tiedostoon.
- Web-paneeli ja botti pyörivät **samassa prosessissa ja samassa portissa** → toimii suoraan Pterodactylin yhdellä allokaatiolla.
- Paneeli ei lataa mitään CDN:stä, joten se toimii myös LAN-verkossa ilman nettiä.

## Ominaisuudet

| Osa | Mitä tekee |
|---|---|
| **Tiimit** | Luo esim. *Tiimi 1–4* yhdellä klikkauksella (roolit + halutessa omat teksti/puhekanavat). Jäsenet lisätään hakemalla nimellä, massalisäyksenä (lista nimiä/ID:itä) tai JSON-tuonnilla. Jäsen voi kuulua vain yhteen tiimiin: siirto poistaa vanhan roolin automaattisesti. Lopuksi *Tyhjennä kaikki* tai *Poista kaikki*. |
| **Ilmoitukset** | Embed-ilmoitukset botin nimissä **yhdelle tai usealle kanavalle kerralla** (pikanapit tiimikanaville, esim. map ban -linkki molemmille tiimeille). Valitut serverit liitetään mukaan (IP, portti, salasana). Pingaus (@here/@everyone/rooli tai *kanavan tiimi*), kiinnitys, ajastus, valmiit pohjat ja esikatselu. |
| **Roolit** | **Roolipaneelit:** viesti, jonka napeista jäsenet ottavat/poistavat itselleen roolin (esim. CS2, Minecraft, Bingo, Tetris) – tila "useita" tai "vain yksi". Uuden roolin voi luoda suoraan paneelista, halutessa oman kanavan kanssa (näkyy vain roolin saaneille). **Jäsenten roolit:** hae jäsen ja lisää/poista rooleja, tai anna rooli monelle kerralla. Botti ei koskaan jaa omaa rooliaan korkeampia tai integraatioiden rooleja. |
| **Serverit** | CS2-, Minecraft- ym. serverien osoitteet. Komennot `/serverit` ja `/ip`, sekä kanavalla pysyvä serverilista, joka päivittyy itsestään. Valinnaisesti Pterodactyl-virtanapit (käynnistä/uudelleenkäynnistä/sammuta). |
| **Minecraft** | Tilan seuranta (online, pelaajat), automaattisesti päivittyvä tilaviesti, `/mc whitelist` pelaajille, RCON-konsoli paneelissa ja `/mc komento` ylläpidolle. |
| **Valvonta** | Automod (kielletyt sanat, kutsulinkit, linkit, spämmi → hiljennys), varoitukset (automaattinen hiljennys N:nnestä), modiloki-kanava, tervetuloviesti ja automaattinen rooli. |
| **Rajapinta** | Turnausjärjestelmä voi syöttää tiimit ja ilmoitukset botille `API_TOKEN`-avaimella. |

### Slash-komennot

| Komento | Kuka | |
|---|---|---|
| `/tiimi lisää · poista · lista · luo` | Manage Roles | tiimiroolien hallinta |
| `/serverit`, `/ip <serveri>` | kaikki | serverien osoitteet |
| `/mc status`, `/mc whitelist <nimi>` | kaikki (whitelistin voi rajata) | Minecraft |
| `/mc komento <komento>` | Administrator | RCON |
| `/varoita`, `/varoitukset`, `/hiljennä` | Moderate Members | valvonta |
| `/siivoa <määrä>` | Manage Messages | poista viestejä |
| `/ilmoita` | Manage Server | pikailmoitus kanavalle |

Komentojen oikeuksia voi hienosäätää Discordissa: *Palvelinasetukset → Integraatiot → botti*.

---

## 1. Discord-botin luonti (kerran)

1. <https://discord.com/developers/applications> → **New Application** → nimeksi esim. *Liftup*.
2. **Bot**-välilehti → **Reset Token** → kopioi talteen (`DISCORD_TOKEN`).
3. Samalla sivulla kytke päälle **Server Members Intent** ja **Message Content Intent**. *(Ilman näitä botti ei käynnisty – paneeli kertoo virheen.)*
4. Kutsu botti palvelimelle (vaihda `CLIENT_ID` = Application ID):
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=1099783302160
   ```
5. **Tärkeää:** *Palvelinasetukset → Roolit* – vedä botin rooli **tiimiroolien yläpuolelle**. Discord ei anna botin jakaa itseään korkeampia rooleja.
6. Kopioi palvelimen ID (Discord-asetukset → Lisäasetukset → Developer Mode, sitten oikea klikkaus palvelimeen → *Copy Server ID*) → `GUILD_ID`.

## 2. Testiympäristö: Docker omalla palvelimella

```bash
cp .env.example .env      # täytä DISCORD_TOKEN, GUILD_ID, ADMIN_PASSWORD (+ API_TOKEN)
docker compose up -d --build
docker compose logs -f    # odota: "Kirjauduttu: Liftup#1234" ja "Slash-komennot rekisteröity"
```

Paneeli: `http://<palvelimen-ip>:8080`. Data säilyy kansiossa `./data`.

Ilman Dockeria: `npm install && ADMIN_PASSWORD=... DISCORD_TOKEN=... GUILD_ID=... npm start`.

> Testiä varten kannattaa tehdä erillinen testibotti ja testi-Discord. Tuotantoon vaihdetaan vain `DISCORD_TOKEN` ja `GUILD_ID`.

## 3. Tuotanto: Pterodactyl

1. **Admin → Nests → Import Egg** → `egg-liftup-bot.json` (PTDL_v2-muoto).
2. Luo uusi serveri munalla *Liftup Bot*. Pääallokaation portista tulee **web-paneelin portti** (botti lukee sen `SERVER_PORT`-muuttujasta automaattisesti). RAM 256–512 MB riittää.
3. Täytä muuttujat: `DISCORD_TOKEN`, `GUILD_ID`, `ADMIN_PASSWORD`, `API_TOKEN` (+ Minecraft/Pterodactyl jos käytössä).
4. Koodi palvelimelle **jompikumpi**:
   - aseta `GIT_ADDRESS` (+ `GIT_TOKEN` yksityiselle repolle) ja **Reinstall**, tai
   - lataa paketin sisältö (`package.json`, `package-lock.json`, `src/`) File Managerilla palvelimen juureen.
5. Käynnistä. Konsolissa näkyy `Web-paneeli käynnissä`, jolloin Pterodactyl merkitsee serverin käynnissä olevaksi.

**Jos v2:n munatuonti temppuilee** (v2 on vielä beta): käytä mitä tahansa yleistä Node.js-munaa (`ghcr.io/parkervcp/yolks:nodejs_22`), aseta käynnistyskomennoksi `npm install --omit=dev && node src/index.js` ja lisää samat ympäristömuuttujat. Muuta botti ei tarvitse.

**Siirto testistä tuotantoon tiimeineen ja asetuksineen:** kopioi `data/db.json` testistä tuotannon `data/`-kansioon ennen käynnistystä. Jos Discord-palvelin vaihtuu, roolien ja kanavien ID:t eivät täsmää – silloin aloita tyhjällä `db.json`:lla ja syötä serverit uudelleen.

## 4. Minecraft

`server.properties`:
```
enable-rcon=true
rcon.port=25575
rcon.password=pitkä-salasana
```
Jos MC-serveri pyörii Pterodactylissa, RCON-portille tarvitaan oma allokaatio (ellei botti ole samassa Docker-verkossa). Aseta osoite ja salasana paneelin *Minecraft*-sivulla tai ympäristömuuttujilla `MC_HOST`, `MC_RCON_PORT`, `MC_RCON_PASSWORD`.

## 5. Turnausjärjestelmän integraatio

Kaikki paneelin rajapinnat toimivat myös `Authorization: Bearer $API_TOKEN` -otsakkeella.

```bash
# Tiimit turnausjärjestelmästä → Discord-roolit (replace: tyhjentää ensin)
curl -X POST http://botti:8080/api/teams/import \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"replace":true,"createChannels":false,"teams":[
        {"name":"Tiimi 1","members":["123456789012345678","pelaaja2"]},
        {"name":"Tiimi 2","members":["pelaaja3"]}]}'

# Ottelukuulutus
curl -X POST http://botti:8080/api/announcements \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"channelId":"KANAVA_ID","title":"⚔️ Tiimi 1 vs Tiimi 2","body":"Alkaa nyt!","mention":"none"}'
```

Jäsenet tunnistetaan Discord-ID:llä, käyttäjänimellä, näyttönimellä tai `<@mention>`-muodolla. Vastaus kertoo, ketä ei löytynyt.

Muut: `GET /api/teams`, `POST /api/teams/generate {count,prefix}`, `POST /api/teams/:id/members {users:[…]}`, `DELETE /api/teams/:id/members/:userId`, `POST /api/teams/reset`, `GET|POST|PUT|DELETE /api/servers`, `GET /api/status`, `POST /api/roles/:roleId/members {users:[…]}`, `GET|POST|PUT|DELETE /api/role-panels`. Ilmoitukselle useampi kanava: `"channelIds": ["…","…"]`, ja `"mention": "team"` pingaa tiimikanavilla kunkin tiimin roolia. Kohteeksi voi antaa myös tiimien nimet: `"teams": ["Tiimi 1","Tiimi 2"]` (= niiden kanavat), ja `"serverNames": ["CS2 #1"]` liittää samannimisen serverin osoitteen.

`POST /api/members/resolve {users:[…]}` tarkistaa, löytyvätkö nimet palvelimelta, ja palauttaa käyttäjänimen.

**Tourney-integraatio:** Tourney (turnausjärjestelmä) käyttää näitä rajapintoja suoraan: tiimien synkronointi, otteluiden kuulutukset, tiimikohtaiset map ban -linkit, ilmoittautuneiden pelaajien tiimiroolit, tulokset ja mestari. Asetukset tehdään Tourneyn *Discord*-sivulla (botin osoite + `API_TOKEN`).

## Tietoturva

- Salaisuudet (token, salasanat) vain ympäristömuuttujissa – paneeli ei näytä niitä.
- Kirjautuminen: salasana + HttpOnly-istuntoeväste (12 h), 5 väärää yritystä → minuutin esto.
- Jos paneeli näkyy internetiin, laita se reverse proxyn taakse HTTPS:llä (esim. Nginx Proxy Manager / Caddy). LANissa riittää sisäverkko.

## Tiedostot

```
src/index.js            käynnistys
src/config.js           ympäristömuuttujat
src/store.js            data/db.json
src/bot/teams.js        tiimiroolit, kanavat, tuonti
src/bot/announce.js     ilmoitukset, ajastus, serverilista
src/bot/minecraft.js    MC-ping, RCON, tilaviesti
src/bot/moderation.js   automod, varoitukset, modiloki, tervetuloviesti
src/bot/pterodactyl.js  virtatoiminnot (valinnainen)
src/bot/commands.js     slash-komennot
src/web/server.js       REST-rajapinta + kirjautuminen
src/web/public/         web-paneeli
egg-liftup-bot.json     Pterodactyl-muna
```

## Tekijä

Liftup-botti: **Mikael Riihimäki**.
