import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ===== pagina prodotto "Grafite" — il modello "occhiale-3dm" (il file Rhino
   originale dell'utente, lo stesso usato nel configuratore occhiali.html) =====
   Una sola lunga sezione (lo "stage") resta fissa sullo schermo (position: sticky)
   mentre la pagina scorre: la percentuale di scorrimento dentro quella sezione
   guida tutta l'animazione 3D (apertura → chiusura stanghette → esploso con
   etichette → misure), non il tempo. Più sotto, una seconda scena indipendente
   permette di personalizzare i colori e provarli con la fotocamera. */

document.addEventListener('DOMContentLoaded', function() {
    const btnMenu = document.querySelector('.btn-menu');
    const btnClose = document.querySelector('.btn-close');
    const mobileNavWrapper = document.querySelector('.mobile-nav-wrapper');
    if (!btnMenu || !mobileNavWrapper) return;
    const navLinks = document.querySelectorAll('.mobile-nav-wrapper .nav-link');
    btnMenu.addEventListener('click', function() {
        mobileNavWrapper.style.display = 'flex';
        setTimeout(() => mobileNavWrapper.classList.add('show'), 10);
    });
    function closeMenu() {
        mobileNavWrapper.classList.remove('show');
        setTimeout(() => { if (!mobileNavWrapper.classList.contains('show')) mobileNavWrapper.style.display = 'none'; }, 300);
    }
    btnClose.addEventListener('click', closeMenu);
    mobileNavWrapper.addEventListener('click', function(e) {
        let isLink = false;
        navLinks.forEach(l => { if (l.contains(e.target)) isLink = true; });
        if (!isLink) closeMenu();
    });
});

/* ===== texture procedurali (canvas generato, nessun file immagine esterno) ===== */
function creaTexturaRumore(dimensione, ripetizioni, contrasto, base) {
    const canvas = document.createElement('canvas');
    canvas.width = dimensione;
    canvas.height = dimensione;
    const ctx = canvas.getContext('2d');
    const immagine = ctx.createImageData(dimensione, dimensione);
    for (let i = 0; i < immagine.data.length; i += 4) {
        const valore = Math.max(0, Math.min(255, base + (Math.random() - 0.5) * contrasto));
        immagine.data[i] = valore;
        immagine.data[i + 1] = valore;
        immagine.data[i + 2] = valore;
        immagine.data[i + 3] = 255;
    }
    ctx.putImageData(immagine, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(ripetizioni, ripetizioni);
    return texture;
}

const texturaMontatura = creaTexturaRumore(128, 20, 55, 60);
const texturaLente = creaTexturaRumore(128, 5, 12, 150);

function nuovoSetMateriali() {
    return {
        montatura: new THREE.MeshStandardMaterial({
            color: 0x26272a, metalness: 0.55, roughness: 0.42,
            roughnessMap: texturaMontatura, bumpMap: texturaMontatura, bumpScale: 0.0008
        }),
        lenti: new THREE.MeshPhysicalMaterial({
            color: 0x2c2e31, metalness: 0, roughness: 0.22, roughnessMap: texturaLente,
            transmission: 0, ior: 1.5, clearcoat: 0.25, clearcoatRoughness: 0.5,
            transparent: true, opacity: 0.98
        }),
        dettaglio: new THREE.MeshStandardMaterial({ color: 0x9a9a9c, metalness: 0.4, roughness: 0.35 }),
        cerniere: new THREE.MeshStandardMaterial({ color: 0x3a3a3c, metalness: 0.85, roughness: 0.3 })
    };
}

/* ===== scomposizione del file "occhiale-3dm.glb" =====
   il file non ha nomi leggibili sui singoli pezzi (sono tutti "mesh-N"): questa
   mappa viene dalla stessa analisi già fatta per il configuratore in
   occhiali-configuratore.js (nodoAGruppo), più l'individuazione di quali pezzi
   stanno sulla stanghetta destra/sinistra, verificata sulle coordinate reali del
   file (vedi diario di lavoro). "mesh-0" è il piedistallo d'appoggio di Rhino,
   enormemente più grande degli occhiali: non va mai mostrato. */
const NODO_BASE = 'mesh-0';
const GRUPPI_MATERIALE = {
    montatura: ['mesh-1', 'mesh-2', 'mesh-5', 'mesh-6', 'mesh-11', 'mesh-17', 'mesh-18'],
    lenti: ['mesh-4'],
    dettaglio: ['mesh-3'],
    cerniere: ['mesh-9', 'mesh-14', 'mesh-7', 'mesh-8', 'mesh-10', 'mesh-12', 'mesh-13', 'mesh-15', 'mesh-16']
};
const NOMI_GRUPPO = { montatura: 'Montatura', lenti: 'Lenti', dettaglio: 'Dettaglio', cerniere: 'Cerniere' };
// un pezzo rappresentativo per gruppo, usato per ancorare l'etichetta durante l'esploso
const MESH_ETICHETTA = { montatura: 'mesh-5', lenti: 'mesh-4', dettaglio: 'mesh-3', cerniere: 'mesh-7' };
const GRUPPO_DESTRA = ['mesh-6', 'mesh-18', 'mesh-7', 'mesh-8', 'mesh-9', 'mesh-10'];
const GRUPPO_SINISTRA = ['mesh-11', 'mesh-17', 'mesh-12', 'mesh-13', 'mesh-14', 'mesh-15', 'mesh-16'];
// i pezzi della minuteria più vicini al fulcro reale della cerniera: la loro posizione
// media è un'approssimazione affidabile di dove si trova davvero il perno
const CERNIERA_DESTRA = ['mesh-7', 'mesh-8', 'mesh-9', 'mesh-10'];
const CERNIERA_SINISTRA = ['mesh-12', 'mesh-13', 'mesh-14', 'mesh-15'];
// larghezza reale di riferimento: il file non porta quote reali (è in unità Rhino
// arbitrarie), quindi assumiamo la larghezza frontale media di un occhiale (~14 cm)
// per ricavare un fattore di scala coerente, come già fatto altrove sul sito
const LARGHEZZA_RIFERIMENTO_M = 0.14;

function trovaGruppoMateriale(nomeNodo) {
    for (const chiave in GRUPPI_MATERIALE) {
        if (GRUPPI_MATERIALE[chiave].includes(nomeNodo)) return chiave;
    }
    return null;
}

/* ===== costruisce una copia pronta all'uso del modello: ricalcola i normali
   mancanti, nasconde il piedistallo, scala il file alle unità reali (metri) e lo
   ricentra sull'origine. Restituisce anche l'elenco dei pezzi con il loro gruppo
   materiale/lato, pronto per essere colorato o animato da chi la chiama. ===== */
function preparaModello(scenaGltf) {
    const daRimuovere = [];
    scenaGltf.traverse(function(nodo) {
        if (nodo.isLine || nodo.isPoints) daRimuovere.push(nodo);
        if (nodo.name === NODO_BASE) daRimuovere.push(nodo);
    });
    daRimuovere.forEach(n => n.parent.remove(n));

    scenaGltf.updateMatrixWorld(true);

    const schede = [];
    scenaGltf.traverse(function(nodo) {
        if (!nodo.isMesh) return;
        if (!nodo.geometry.attributes.normal) {
            nodo.geometry.computeVertexNormals();
        }
        const box = new THREE.Box3().setFromObject(nodo);
        const centro = new THREE.Vector3();
        box.getCenter(centro);
        schede.push({
            mesh: nodo,
            centro: centro,
            box: box,
            gruppoMateriale: trovaGruppoMateriale(nodo.name),
            lato: GRUPPO_DESTRA.includes(nodo.name) ? 'dx' : (GRUPPO_SINISTRA.includes(nodo.name) ? 'sx' : 'fronte')
        });
    });

    const boxTotale = new THREE.Box3();
    schede.forEach(s => boxTotale.union(s.box));
    const dimensioniGrezze = new THREE.Vector3();
    boxTotale.getSize(dimensioniGrezze);

    // fattore di scala: la larghezza grezza del file diventa 14 cm reali
    const scalaModello = LARGHEZZA_RIFERIMENTO_M / dimensioniGrezze.x;
    scenaGltf.scale.setScalar(scalaModello);
    scenaGltf.updateMatrixWorld(true);

    // ricalcola centro e box in metri, dopo la scala
    const boxFinale = new THREE.Box3();
    schede.forEach(function(s) {
        s.box.setFromObject(s.mesh);
        s.box.getCenter(s.centro);
        boxFinale.union(s.box);
    });
    const centroTotale = new THREE.Vector3();
    boxFinale.getCenter(centroTotale);
    const dimensioni = new THREE.Vector3();
    boxFinale.getSize(dimensioni);

    scenaGltf.position.sub(centroTotale);
    schede.forEach(s => s.centro.sub(centroTotale));

    function mediaCentri(nomiNodi) {
        const trovati = schede.filter(s => nomiNodi.includes(s.mesh.name));
        const media = new THREE.Vector3();
        trovati.forEach(s => media.add(s.centro));
        if (trovati.length) media.divideScalar(trovati.length);
        return media;
    }

    return {
        schede: schede,
        misure: { larghezza: dimensioni.x * 100, altezza: dimensioni.y * 100, profondita: dimensioni.z * 100 },
        pernoDx: mediaCentri(CERNIERA_DESTRA),
        pernoSx: mediaCentri(CERNIERA_SINISTRA)
    };
}

/* ======================================================================
   PARTE 1 — lo stage agganciato allo scroll in cima alla pagina
   ====================================================================== */

const palco = document.getElementById('palco-3d');
const scena = new THREE.Scene();

const FOV_GRADI = 28;
const camera = new THREE.PerspectiveCamera(FOV_GRADI, palco.clientWidth / palco.clientHeight, 0.01, 50);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(palco.clientWidth, palco.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
palco.appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
scena.environment = pmrem.fromScene(new RoomEnvironment(), 0.08).texture;
scena.environmentIntensity = 1.4;

function allestisciLuciStudio(destinazione) {
    destinazione.add(new THREE.AmbientLight(0xffffff, 0.6));
    const luceChiave = new THREE.DirectionalLight(0xfff1dd, 2.6);
    luceChiave.position.set(0.35, 0.6, 0.55);
    luceChiave.castShadow = true;
    luceChiave.shadow.mapSize.set(1024, 1024);
    luceChiave.shadow.camera.near = 0.05;
    luceChiave.shadow.camera.far = 3;
    luceChiave.shadow.camera.left = -0.3;
    luceChiave.shadow.camera.right = 0.3;
    luceChiave.shadow.camera.top = 0.3;
    luceChiave.shadow.camera.bottom = -0.3;
    luceChiave.shadow.radius = 5;
    destinazione.add(luceChiave);

    const luceRiempimento = new THREE.DirectionalLight(0xcfe0ff, 0.7);
    luceRiempimento.position.set(-0.5, 0.1, 0.4);
    destinazione.add(luceRiempimento);

    const luceBordo = new THREE.DirectionalLight(0xffffff, 1.0);
    luceBordo.position.set(-0.3, 0.45, -0.65);
    destinazione.add(luceBordo);

    const luceBordoDx = new THREE.DirectionalLight(0xffffff, 0.6);
    luceBordoDx.position.set(0.5, 0.3, -0.6);
    destinazione.add(luceBordoDx);
}
allestisciLuciStudio(scena);

function creaPianoOmbra() {
    const piano = new THREE.Mesh(
        new THREE.CircleGeometry(0.16, 48),
        new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    piano.rotation.x = -Math.PI / 2;
    piano.position.y = -0.035;
    piano.receiveShadow = true;
    return piano;
}
scena.add(creaPianoOmbra());

const modelloRoot = new THREE.Group();
scena.add(modelloRoot);

let pivotSx = null;
let pivotDx = null;
const parti = []; // { mesh, restPos, direzione, gruppoMateriale }
let misure = null;
const etichettePosizione = {}; // nome gruppo -> THREE.Vector3 (world) aggiornata ogni frame

const gltfLoader = new GLTFLoader();
gltfLoader.load('glb/occhiale-3dm.glb', function(gltf) {
    costruisciModello(gltf.scene);
}, undefined, function(errore) {
    console.error('Errore nel caricamento del modello:', errore);
});

function costruisciModello(scenaGltf) {
    const preparato = preparaModello(scenaGltf);
    const materiali = nuovoSetMateriali();

    misure = preparato.misure;
    mostraMisure(misure);

    modelloRoot.add(scenaGltf);

    pivotDx = new THREE.Group();
    pivotDx.position.copy(preparato.pernoDx);
    modelloRoot.add(pivotDx);

    pivotSx = new THREE.Group();
    pivotSx.position.copy(preparato.pernoSx);
    modelloRoot.add(pivotSx);

    // centro del solo gruppo "fronte", usato come riferimento per la direzione di
    // esploso di quei pezzi (non il centro di tutto il modello: le lenti avvolgenti
    // spaziano quasi quanto l'intero occhiale e falserebbero il calcolo)
    const schedeFronte = preparato.schede.filter(s => s.lato === 'fronte');
    const centroFronte = new THREE.Vector3();
    schedeFronte.forEach(s => centroFronte.add(s.centro));
    if (schedeFronte.length) centroFronte.divideScalar(schedeFronte.length);

    preparato.schede.forEach(function(s) {
        const mesh = s.mesh;
        const materiale = materiali[s.gruppoMateriale] || materiali.montatura;
        mesh.material = materiale;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        let pivot = null;
        let direzione;
        if (s.lato === 'dx' || s.lato === 'sx') {
            pivot = s.lato === 'dx' ? pivotDx : pivotSx;
            const perno = s.lato === 'dx' ? preparato.pernoDx : preparato.pernoSx;
            const locale = s.centro.clone().sub(perno);
            // le viti delle cerniere stanno quasi esattamente sul perno (locale ≈ 0):
            // senza una spinta propria si limitano a seguire la stanghetta invece di
            // staccarsene, e nell'esploso restavano invisibili come pezzo a parte
            const lateraleExtra = s.gruppoMateriale === 'cerniere' ? 3.2 : 1;
            const profonditaLato = s.gruppoMateriale === 'cerniere' ? 0.9 : -1;
            direzione = new THREE.Vector3(locale.x * 2.4 * lateraleExtra, locale.y * 3.4 * lateraleExtra, profonditaLato);
        } else {
            // sulla parte frontale, montatura/lenti/dettaglio stanno quasi sullo
            // stesso piano: è una spinta in profondità diversa per ciascun gruppo che
            // li separa davvero in tre strati, invece di farli scorrere tutti insieme
            const PROFONDITA_FRONTE = { dettaglio: 1.4, montatura: 0.4, lenti: -1.2 };
            const dx = s.centro.x - centroFronte.x;
            const dy = s.centro.y - centroFronte.y;
            direzione = new THREE.Vector3(dx * 7, dy * 7, PROFONDITA_FRONTE[s.gruppoMateriale] ?? 0.6);
        }
        // scarto deterministico per pezzo (dal numero in "mesh-N"): senza, i pezzi
        // dello stesso gruppo/lato si muovono rigidamente insieme come un blocco
        // unico. Con questo, i 19 pezzi si separano singolarmente, non a gruppi di 4
        const indice = parseInt(mesh.name.replace('mesh-', ''), 10) || 0;
        direzione.x += Math.sin(indice * 12.9898) * 0.5;
        direzione.y += Math.sin(indice * 78.233) * 0.5;
        direzione.z += Math.sin(indice * 37.719) * 0.35;
        if (pivot) pivot.attach(mesh);

        parti.push({
            mesh: mesh,
            restPos: mesh.position.clone(),
            direzione: direzione.lengthSq() < 1e-8 ? new THREE.Vector3(0, 0, 1) : direzione.normalize(),
            gruppoMateriale: s.gruppoMateriale,
            etichetta: MESH_ETICHETTA[s.gruppoMateriale] === mesh.name
        });
    });

    avviaCicloDiRendering();
}

function mostraMisure(m) {
    const valori = {
        larghezza: m.larghezza.toFixed(1).replace('.', ',') + ' cm',
        altezza: m.altezza.toFixed(1).replace('.', ',') + ' cm',
        profondita: m.profondita.toFixed(1).replace('.', ',') + ' cm'
    };
    ['larghezza', 'altezza', 'profondita'].forEach(function(chiave) {
        const nelloStage = document.getElementById('misura-' + chiave);
        const nellaScheda = document.getElementById('specifica-' + chiave);
        if (nelloStage) nelloStage.textContent = valori[chiave];
        if (nellaScheda) nellaScheda.textContent = valori[chiave];
    });
}

/* ===== fasi guidate dallo scroll ===== */
const wrapper = document.getElementById('stage-wrapper');

function calcolaProgresso() {
    const rect = wrapper.getBoundingClientRect();
    const scorribile = wrapper.offsetHeight - window.innerHeight;
    if (scorribile <= 0) return 0;
    return Math.max(0, Math.min(1, -rect.top / scorribile));
}

const FASI = {
    introFine: 0.16,
    chiusuraInizio: 0.16, chiusuraFine: 0.40,
    esplosoInizio: 0.40, esplosoFine: 0.68,
    misuraInizio: 0.70, misuraFine: 0.98
};

function normalizza(valore, inizio, fine) {
    if (fine === inizio) return valore >= fine ? 1 : 0;
    return Math.max(0, Math.min(1, (valore - inizio) / (fine - inizio)));
}
function easeInOut(t) {
    return t * t * (3 - 2 * t);
}


const testiFase = {
    intro: document.getElementById('testo-intro'),
    chiusura: document.getElementById('testo-chiusura'),
    esploso: document.getElementById('testo-esploso'),
    misura: document.getElementById('testo-misura')
};

function impostaTesto(elemento, opacita, spostamento) {
    if (!elemento) return;
    elemento.style.opacity = opacita;
    elemento.style.transform = 'translateX(-50%) translateY(' + spostamento + 'px)';
    elemento.style.pointerEvents = opacita > 0.5 ? 'auto' : 'none';
}

const svgMisure = document.getElementById('svg-misure');
const suggerimentoScroll = document.querySelector('.scroll-suggerimento');
const etichetteComponenti = document.querySelectorAll('.etichetta-componente');
// "dettaglio" e "lenti" sono due pezzi piccoli vicinissimi tra loro (il dettaglio
// crema sta proprio sopra il ponte della lente): senza un piccolo scarto verticale
// le due etichette finiscono esattamente una sopra l'altra
const SCARTO_VERTICALE_ETICHETTA = { lenti: 34, dettaglio: -34 };

function applicaFase(p) {
    const chiusura = easeInOut(normalizza(p, FASI.chiusuraInizio, FASI.chiusuraFine));
    const esploso = easeInOut(normalizza(p, FASI.esplosoInizio, FASI.esplosoFine));
    const misuraProg = easeInOut(normalizza(p, FASI.misuraInizio, FASI.misuraFine));

    // la rotazione dipende SOLO dallo scroll, mai dal tempo: con una rotazione
    // continua le etichette dei componenti (che proiettano un punto 3D fisso sullo
    // schermo) finivano a sovrapporsi in modo imprevedibile a seconda di quando ci
    // si fermava a scorrere. Così l'angolo è sempre lo stesso a parità di scroll.
    const angoloBase = -0.9 + 0.55 * easeInOut(normalizza(p, 0, FASI.introFine));
    modelloRoot.rotation.y = angoloBase + chiusura * 0.25 + esploso * 0.15;

    const distanza = 0.58 + chiusura * 0.04 + esploso * 0.85 + misuraProg * 0.1;
    camera.position.set(0, 0.015 - misuraProg * 0.01, distanza);
    camera.lookAt(0, 0.045, 0);

    if (pivotDx && pivotSx) {
        const angoloChiusura = chiusura * 1.15;
        pivotDx.rotation.y = -angoloChiusura;
        pivotSx.rotation.y = angoloChiusura;
    }

    const distanzaEsploso = esploso * 0.19;
    parti.forEach(function(parte) {
        parte.mesh.position.copy(parte.restPos).addScaledVector(parte.direzione, distanzaEsploso);
    });

    impostaTesto(testiFase.intro, 1 - easeInOut(normalizza(p, 0.02, FASI.introFine)), -easeInOut(normalizza(p, 0.02, FASI.introFine)) * 30);
    const chiusuraTestoIn = normalizza(p, FASI.chiusuraInizio + 0.02, FASI.chiusuraInizio + 0.12);
    const chiusuraTestoOut = normalizza(p, FASI.chiusuraFine - 0.1, FASI.chiusuraFine);
    impostaTesto(testiFase.chiusura, easeInOut(chiusuraTestoIn) * (1 - easeInOut(chiusuraTestoOut)), (1 - easeInOut(chiusuraTestoIn)) * 30);
    const esplosoTestoIn = normalizza(p, FASI.esplosoInizio + 0.02, FASI.esplosoInizio + 0.12);
    const esplosoTestoOut = normalizza(p, FASI.esplosoFine - 0.12, FASI.esplosoFine);
    const esplosoOpacitaTesto = easeInOut(esplosoTestoIn) * (1 - easeInOut(esplosoTestoOut));
    impostaTesto(testiFase.esploso, esplosoOpacitaTesto, (1 - easeInOut(esplosoTestoIn)) * 30);
    const misuraTestoIn = normalizza(p, FASI.misuraInizio, FASI.misuraInizio + 0.08);
    const misuraTestoOut = normalizza(p, FASI.misuraFine - 0.06, FASI.misuraFine);
    const misuraOpacita = easeInOut(misuraTestoIn) * (1 - easeInOut(misuraTestoOut));
    impostaTesto(testiFase.misura, misuraOpacita, (1 - easeInOut(misuraTestoIn)) * 30);

    if (suggerimentoScroll) {
        suggerimentoScroll.style.opacity = 1 - easeInOut(normalizza(p, 0.02, 0.1));
    }

    // le etichette dei componenti si vedono solo mentre l'esploso è ben visibile,
    // non ai due estremi (chiuso/fine fase), per non restare incollate a pezzi fermi
    const etichetteOpacita = esplosoOpacitaTesto;
    aggiornaEtichetteComponenti(etichetteOpacita);
    aggiornaLineeMisure(misuraOpacita);
}

function aggiornaEtichetteComponenti(opacita) {
    if (!etichetteComponenti.length) return;
    const rettangolo = palco.getBoundingClientRect();
    if (opacita < 0.02) {
        etichetteComponenti.forEach(el => { el.style.opacity = 0; });
        return;
    }
    const boxTemp = new THREE.Box3();
    const centroTemp = new THREE.Vector3();
    parti.forEach(function(parte) {
        if (!parte.etichetta) return;
        const elemento = document.querySelector('.etichetta-componente[data-gruppo="' + parte.gruppoMateriale + '"]');
        if (!elemento) return;
        // niente getWorldPosition: i vertici di questo file portano la propria
        // posizione "cotta" dentro la geometria, mentre la trasformazione
        // dell'oggetto resta a zero — il vero centro visivo va preso dal bounding
        // box della geometria, non dalla posizione dell'Object3D
        boxTemp.setFromObject(parte.mesh);
        boxTemp.getCenter(centroTemp);
        const proiettato = centroTemp.project(camera);
        const scarto = SCARTO_VERTICALE_ETICHETTA[parte.gruppoMateriale] || 0;
        elemento.style.left = ((proiettato.x * 0.5 + 0.5) * rettangolo.width) + 'px';
        elemento.style.top = ((1 - (proiettato.y * 0.5 + 0.5)) * rettangolo.height + scarto) + 'px';
        elemento.style.opacity = opacita;
    });
}

function aggiornaLineeMisure(opacita) {
    if (!svgMisure) return;
    svgMisure.style.opacity = opacita;
    const etichettaLarghezza = document.getElementById('etichetta-larghezza');
    const etichettaProfondita = document.getElementById('etichetta-profondita');
    if (etichettaLarghezza) etichettaLarghezza.style.opacity = opacita;
    if (etichettaProfondita) etichettaProfondita.style.opacity = opacita;
    if (opacita < 0.02 || !misure) return;

    const rettangolo = palco.getBoundingClientRect();
    function proietta(v) {
        const clone = v.clone().project(camera);
        return {
            x: (clone.x * 0.5 + 0.5) * rettangolo.width,
            y: (1 - (clone.y * 0.5 + 0.5)) * rettangolo.height
        };
    }

    const semiLarghezza = (misure.larghezza / 100) / 2;
    const semiAltezza = (misure.altezza / 100) / 2;
    const semiProfondita = (misure.profondita / 100) / 2;

    const puntoA = proietta(new THREE.Vector3(-semiLarghezza, -semiAltezza * 1.8, 0));
    const puntoB = proietta(new THREE.Vector3(semiLarghezza, -semiAltezza * 1.8, 0));
    const puntoC = proietta(new THREE.Vector3(0, semiAltezza * 1.8, -semiProfondita));
    const puntoD = proietta(new THREE.Vector3(0, semiAltezza * 1.8, semiProfondita));

    impostaLinea('linea-larghezza', puntoA, puntoB);
    impostaEtichetta('etichetta-larghezza', puntoA, puntoB);
    impostaLinea('linea-profondita', puntoC, puntoD);
    impostaEtichetta('etichetta-profondita', puntoC, puntoD);
}

function impostaLinea(id, a, b) {
    const linea = document.getElementById(id);
    if (!linea) return;
    linea.setAttribute('x1', a.x);
    linea.setAttribute('y1', a.y);
    linea.setAttribute('x2', b.x);
    linea.setAttribute('y2', b.y);
}

function impostaEtichetta(id, a, b) {
    const etichetta = document.getElementById(id);
    if (!etichetta) return;
    etichetta.style.left = ((a.x + b.x) / 2) + 'px';
    etichetta.style.top = ((a.y + b.y) / 2) + 'px';
}

function avviaCicloDiRendering() {
    function ciclo() {
        requestAnimationFrame(ciclo);
        applicaFase(calcolaProgresso());
        renderer.render(scena, camera);
    }
    ciclo();
}

window.addEventListener('resize', function() {
    camera.aspect = palco.clientWidth / palco.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(palco.clientWidth, palco.clientHeight);
});

/* ======================================================================
   PARTE 2 — "Personalizza i tuoi": una seconda scena indipendente, con i
   colori modificabili dal vivo e la prova virtuale con la fotocamera
   (stessa tecnica — MediaPipe FaceLandmarker — già usata in scheda.js)
   ====================================================================== */

const palco2 = document.getElementById('palco-personalizza');
if (palco2) {
    avviaPersonalizzazione();
}

function avviaPersonalizzazione() {
    const scena2 = new THREE.Scene();
    const camera2 = new THREE.PerspectiveCamera(30, palco2.clientWidth / palco2.clientHeight, 0.01, 50);
    camera2.position.set(0, 0.01, 0.55);

    const renderer2 = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer2.setSize(palco2.clientWidth, palco2.clientHeight);
    renderer2.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer2.shadowMap.enabled = true;
    renderer2.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer2.toneMapping = THREE.ACESFilmicToneMapping;
    renderer2.toneMappingExposure = 1.15;
    palco2.appendChild(renderer2.domElement);

    scena2.environment = pmrem.fromScene(new RoomEnvironment(), 0.08).texture;
    scena2.environmentIntensity = 1.4;
    allestisciLuciStudio(scena2);
    scena2.add(creaPianoOmbra());

    const pernoRotazione = new THREE.Group();
    scena2.add(pernoRotazione);

    const materiali2 = nuovoSetMateriali();
    let modelloPersonalizza = null;

    new GLTFLoader().load('glb/occhiale-3dm.glb', function(gltf) {
        const preparato = preparaModello(gltf.scene);
        preparato.schede.forEach(function(s) {
            s.mesh.material = materiali2[s.gruppoMateriale] || materiali2.montatura;
            s.mesh.castShadow = true;
            s.mesh.receiveShadow = true;
        });
        pernoRotazione.add(gltf.scene);
        modelloPersonalizza = gltf.scene;
        costruisciPannelloColori(materiali2);
        avviaRenderPersonalizza();
    });

    function avviaRenderPersonalizza() {
        function ciclo() {
            requestAnimationFrame(ciclo);
            pernoRotazione.rotation.y += 0.0025;
            renderer2.render(scena2, camera2);
        }
        ciclo();
    }

    window.addEventListener('resize', function() {
        camera2.aspect = palco2.clientWidth / palco2.clientHeight;
        camera2.updateProjectionMatrix();
        renderer2.setSize(palco2.clientWidth, palco2.clientHeight);
    });

    /* ----- pannello colori: 4 righe (una per gruppo), 6 colori ciascuna ----- */
    const PALETTE = [
        { hex: '#26272a', nome: 'Grafite' },
        { hex: '#7f5539', nome: 'Marrone' },
        { hex: '#2f5d8a', nome: 'Blu' },
        { hex: '#91171f', nome: 'Rosso' },
        { hex: '#3a5a40', nome: 'Verde' },
        { hex: '#c9a227', nome: 'Giallo' }
    ];

    function costruisciPannelloColori(materiali) {
        const contenitore = document.getElementById('personalizza-colori');
        if (!contenitore) return;
        contenitore.innerHTML = '';
        Object.keys(NOMI_GRUPPO).forEach(function(chiave) {
            const materiale = materiali[chiave];
            const riga = document.createElement('div');
            riga.className = 'settore';
            const nomeRiga = document.createElement('h4');
            nomeRiga.className = 'settore-nome';
            nomeRiga.textContent = NOMI_GRUPPO[chiave];
            riga.appendChild(nomeRiga);
            PALETTE.forEach(function(colore) {
                const campione = document.createElement('button');
                campione.type = 'button';
                campione.className = 'campione';
                campione.style.backgroundColor = colore.hex;
                campione.title = colore.nome;
                if (chiave === 'montatura' && colore.nome === 'Grafite') campione.classList.add('selected');
                campione.addEventListener('click', function() {
                    materiale.color.set(colore.hex);
                    riga.querySelectorAll('.campione').forEach(c => c.classList.remove('selected'));
                    campione.classList.add('selected');
                });
                riga.appendChild(campione);
            });
            contenitore.appendChild(riga);
        });
    }

    /* ===== prova virtuale con la fotocamera: stessa tecnica di scheda.js
       (MediaPipe FaceLandmarker, interamente nel browser) applicata al modello
       con i colori appena scelti qui sopra ===== */
    const btnApriProva = document.getElementById('apri-prova-virtuale');
    const btnChiudiProva = document.getElementById('chiudi-prova-virtuale');
    const pannelloProva = document.getElementById('prova-virtuale');
    const videoProva = document.getElementById('prova-video');
    const canvasProva = document.getElementById('prova-canvas');
    const statoProva = document.getElementById('prova-stato');
    const regolazioneProva = document.getElementById('prova-regolazione');
    const btnRimpicciolisci = document.getElementById('prova-rimpicciolisci');
    const btnIngrandisci = document.getElementById('prova-ingrandisci');
    const btnScatta = document.getElementById('prova-scatta');
    const risultatoProva = document.getElementById('prova-risultato');
    const fotoProva = document.getElementById('prova-foto');
    const btnCondividi = document.getElementById('prova-condividi');
    const btnScarica = document.getElementById('prova-scarica');
    const btnRiprova = document.getElementById('prova-riprova');
    const linkWhatsapp = document.getElementById('prova-whatsapp');
    const linkTelegram = document.getElementById('prova-telegram');
    const btnInstagram = document.getElementById('prova-instagram');

    if (!btnApriProva) return; // markup della prova virtuale non presente in pagina

    let provaAttiva = false;
    let faceLandmarkerPromise = null;
    let flussoCamera = null;
    let rendererProva = null;
    let sceneProva = null;
    let cameraProva = null;
    let pernoVoltoProva = null;
    let contenitoreScalaProva = null;
    let ultimaFotoUrl = null;

    // stessa calibrazione, verificata dal vivo, già usata in scheda.js: le unità
    // della matrice di posa di MediaPipe sono centimetri
    const SCALA_VOLTO = 54;
    const SPOSTAMENTO_VOLTO = new THREE.Vector3(-1.4, 5.2, 1);
    let moltiplicatoreDimensione = 1;

    btnApriProva.addEventListener('click', avviaProvaVirtuale);
    if (btnChiudiProva) btnChiudiProva.addEventListener('click', chiudiProvaVirtuale);
    if (btnRimpicciolisci) btnRimpicciolisci.addEventListener('click', () => regolaDimensione(0.92));
    if (btnIngrandisci) btnIngrandisci.addEventListener('click', () => regolaDimensione(1 / 0.92));
    if (btnScatta) btnScatta.addEventListener('click', scattaFoto);
    if (btnRiprova) btnRiprova.addEventListener('click', tornaAllaFotocamera);
    if (btnScarica) btnScarica.addEventListener('click', scaricaFoto);
    if (btnCondividi) btnCondividi.addEventListener('click', condividiFoto);
    if (btnInstagram) btnInstagram.addEventListener('click', condividiFoto);
    window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && provaAttiva) chiudiProvaVirtuale();
    });

    function regolaDimensione(fattore) {
        moltiplicatoreDimensione *= fattore;
        if (contenitoreScalaProva) contenitoreScalaProva.scale.setScalar(SCALA_VOLTO * moltiplicatoreDimensione);
    }

    async function caricaFaceLandmarker() {
        if (!faceLandmarkerPromise) {
            faceLandmarkerPromise = (async function() {
                const { FaceLandmarker, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
                const risolutore = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
                return FaceLandmarker.createFromOptions(risolutore, {
                    baseOptions: {
                        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                        delegate: 'GPU'
                    },
                    outputFaceBlendshapes: false,
                    outputFacialTransformationMatrixes: true,
                    runningMode: 'VIDEO',
                    numFaces: 1
                });
            })();
        }
        return faceLandmarkerPromise;
    }

    async function avviaProvaVirtuale() {
        if (!modelloPersonalizza || provaAttiva) return;
        provaAttiva = true;
        pannelloProva.hidden = false;
        statoProva.textContent = 'Attivazione della fotocamera…';

        try {
            flussoCamera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        } catch (errore) {
            statoProva.textContent = 'Non riesco ad accedere alla fotocamera' + (errore && errore.message ? ': ' + errore.message : '.');
            console.error('Errore nell\'accesso alla fotocamera:', errore);
            return;
        }
        if (!provaAttiva) { fermaTracce(); return; }

        videoProva.srcObject = flussoCamera;
        await videoProva.play();

        statoProva.textContent = 'Caricamento del riconoscimento del volto…';
        let faceLandmarker;
        try {
            faceLandmarker = await caricaFaceLandmarker();
        } catch (errore) {
            statoProva.textContent = 'Non riesco a caricare il riconoscimento del volto in questo momento.';
            console.error('Errore nel caricare FaceLandmarker:', errore);
            return;
        }
        if (!provaAttiva) { fermaTracce(); return; }

        statoProva.textContent = 'Inquadra il tuo viso.';
        impostaScenaProva();
        animaProva(faceLandmarker);
    }

    function impostaScenaProva() {
        canvasProva.width = videoProva.videoWidth;
        canvasProva.height = videoProva.videoHeight;

        sceneProva = new THREE.Scene();
        cameraProva = new THREE.PerspectiveCamera(63, videoProva.videoWidth / videoProva.videoHeight, 0.01, 100);

        rendererProva = new THREE.WebGLRenderer({ canvas: canvasProva, antialias: true, alpha: true });
        rendererProva.setSize(videoProva.videoWidth, videoProva.videoHeight, false);
        rendererProva.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        sceneProva.add(new THREE.AmbientLight(0xffffff, 1.0));
        const luceProva = new THREE.DirectionalLight(0xffffff, 0.8);
        luceProva.position.set(0, 1, 2);
        sceneProva.add(luceProva);

        // clone() copia la gerarchia ma condivide gli stessi materiali (quelli già
        // colorati dal pannello qui sopra): è proprio quello che vogliamo
        const copiaModello = modelloPersonalizza.clone();
        contenitoreScalaProva = new THREE.Group();
        contenitoreScalaProva.add(copiaModello);
        contenitoreScalaProva.scale.setScalar(SCALA_VOLTO * moltiplicatoreDimensione);
        contenitoreScalaProva.position.copy(SPOSTAMENTO_VOLTO);

        pernoVoltoProva = new THREE.Group();
        pernoVoltoProva.add(contenitoreScalaProva);
        pernoVoltoProva.matrixAutoUpdate = false;
        pernoVoltoProva.visible = false;
        sceneProva.add(pernoVoltoProva);

        if (regolazioneProva) regolazioneProva.hidden = false;
        if (btnScatta) btnScatta.hidden = false;
    }

    function animaProva(faceLandmarker) {
        if (!provaAttiva) return;
        requestAnimationFrame(function() { animaProva(faceLandmarker); });

        if (videoProva.readyState >= 2) {
            const risultati = faceLandmarker.detectForVideo(videoProva, performance.now());
            const matrice = risultati.facialTransformationMatrixes;
            if (matrice && matrice.length > 0) {
                pernoVoltoProva.visible = true;
                pernoVoltoProva.matrix.fromArray(matrice[0].data);
                pernoVoltoProva.matrixWorldNeedsUpdate = true;
                statoProva.textContent = '';
            } else {
                pernoVoltoProva.visible = false;
                statoProva.textContent = 'Non trovo un viso: avvicinati e inquadra bene il volto.';
            }
        }
        rendererProva.render(sceneProva, cameraProva);
    }

    function fermaTracce() {
        if (flussoCamera) {
            flussoCamera.getTracks().forEach(t => t.stop());
            flussoCamera = null;
        }
        videoProva.srcObject = null;
    }

    function chiudiProvaVirtuale() {
        provaAttiva = false;
        pannelloProva.hidden = true;
        fermaTracce();
        if (rendererProva) { rendererProva.dispose(); rendererProva = null; }
        sceneProva = null;
        cameraProva = null;
        pernoVoltoProva = null;
        contenitoreScalaProva = null;
        moltiplicatoreDimensione = 1;
        if (regolazioneProva) regolazioneProva.hidden = true;
        if (btnScatta) btnScatta.hidden = true;
        nascondiRisultatoFoto();
    }

    function scattaFoto() {
        if (!rendererProva) return;
        try {
            rendererProva.render(sceneProva, cameraProva);
            const larghezza = videoProva.videoWidth || canvasProva.width;
            const altezza = videoProva.videoHeight || canvasProva.height;
            if (!larghezza || !altezza) {
                statoProva.textContent = 'La fotocamera non è ancora pronta: riprova tra un istante.';
                return;
            }
            const canvasFoto = document.createElement('canvas');
            canvasFoto.width = larghezza;
            canvasFoto.height = altezza;
            const ctx = canvasFoto.getContext('2d');
            ctx.translate(larghezza, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(videoProva, 0, 0, larghezza, altezza);
            ctx.drawImage(canvasProva, 0, 0, larghezza, altezza);
            canvasFoto.toBlob(function(blob) {
                if (!blob) {
                    statoProva.textContent = 'Non sono riuscito a creare la foto: riprova.';
                    return;
                }
                mostraRisultatoFoto(blob);
            }, 'image/jpeg', 0.92);
        } catch (errore) {
            statoProva.textContent = 'Non sono riuscito a scattare la foto: riprova.';
            console.error('Errore nello scatto della foto:', errore);
        }
    }

    function mostraRisultatoFoto(blob) {
        if (ultimaFotoUrl) URL.revokeObjectURL(ultimaFotoUrl);
        ultimaFotoUrl = URL.createObjectURL(blob);
        fotoProva.src = ultimaFotoUrl;

        const testoCondivisione = 'Ho provato i miei occhiali "Grafite" virtualmente sul catalogo della Triennale Milano';
        const urlPagina = window.location.href;
        if (linkWhatsapp) linkWhatsapp.href = 'https://wa.me/?text=' + encodeURIComponent(testoCondivisione + ' ' + urlPagina);
        if (linkTelegram) linkTelegram.href = 'https://t.me/share/url?url=' + encodeURIComponent(urlPagina) + '&text=' + encodeURIComponent(testoCondivisione);
        risultatoProva.hidden = false;
    }

    function nascondiRisultatoFoto() {
        risultatoProva.hidden = true;
        if (ultimaFotoUrl) { URL.revokeObjectURL(ultimaFotoUrl); ultimaFotoUrl = null; }
        fotoProva.removeAttribute('src');
    }

    function tornaAllaFotocamera() { nascondiRisultatoFoto(); }

    function scaricaFoto() {
        if (!ultimaFotoUrl) return;
        const link = document.createElement('a');
        link.href = ultimaFotoUrl;
        link.download = 'grafite-virtuale.jpg';
        link.click();
    }

    async function condividiFoto() {
        if (!ultimaFotoUrl) return;
        try {
            const risposta = await fetch(ultimaFotoUrl);
            const blob = await risposta.blob();
            const file = new File([blob], 'grafite-virtuale.jpg', { type: 'image/jpeg' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: 'Grafite', text: 'I miei occhiali Grafite, provati virtualmente' });
                return;
            }
        } catch (errore) {
            if (errore && errore.name === 'AbortError') return;
            console.error('Errore nella condivisione:', errore);
        }
        scaricaFoto();
    }
}

/* ===== PARTE 3 — i tre riquadri "dettaglio": non foto vere (non ce ne sono),
   ma un render fermo del modello 3D, inquadrato stretto su un gruppo di pezzi
   (lenti / montatura frontale / stanghetta+cerniere). Un solo render, nessun
   ciclo di animazione: resta fisso come una fotografia. ===== */
function creaFotoDettaglio(idContenitore, filtroScheda, direzioneVista) {
    const contenitore = document.getElementById(idContenitore);
    if (!contenitore) return;

    const scenaD = new THREE.Scene();
    const cameraD = new THREE.PerspectiveCamera(32, contenitore.clientWidth / contenitore.clientHeight, 0.01, 50);
    const rendererD = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    rendererD.setSize(contenitore.clientWidth, contenitore.clientHeight);
    rendererD.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererD.shadowMap.enabled = true;
    rendererD.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererD.toneMapping = THREE.ACESFilmicToneMapping;
    rendererD.toneMappingExposure = 1.15;
    contenitore.appendChild(rendererD.domElement);

    scenaD.environment = pmrem.fromScene(new RoomEnvironment(), 0.08).texture;
    scenaD.environmentIntensity = 1.4;
    allestisciLuciStudio(scenaD);

    const materialiD = nuovoSetMateriali();

    new GLTFLoader().load('glb/davorsilic.glb', function(gltf) {
        const preparato = preparaModello(gltf.scene);
        preparato.schede.forEach(function(s) {
            s.mesh.material = materialiD[s.gruppoMateriale] || materialiD.montatura;
            s.mesh.castShadow = true;
            s.mesh.receiveShadow = true;
            s.mesh.visible = filtroScheda(s); // isola il gruppo: il resto resta nascosto
        });
        scenaD.add(gltf.scene);
        gltf.scene.updateMatrixWorld(true);

        // non s.box: preparaModello lo calcola PRIMA di ricentrare il modello
        // sull'origine, quindi resta con le coordinate vecchie: va ricalcolato ora
        const box = new THREE.Box3();
        preparato.schede.filter(filtroScheda).forEach(s => box.expandByObject(s.mesh));
        const centro = new THREE.Vector3();
        box.getCenter(centro);
        const dimensioni = new THREE.Vector3();
        box.getSize(dimensioni);

        const raggio = Math.max(dimensioni.length() * 0.5, 0.008);
        const distanza = (raggio * 1.1) / Math.sin((cameraD.fov * Math.PI / 180) / 2);
        cameraD.position.copy(centro).addScaledVector(direzioneVista, distanza);
        cameraD.lookAt(centro);

        rendererD.render(scenaD, cameraD);
    }, undefined, function(errore) {
        console.error('Errore nel caricamento del modello (riquadro dettaglio):', errore);
    });

    window.addEventListener('resize', function() {
        cameraD.aspect = contenitore.clientWidth / contenitore.clientHeight;
        cameraD.updateProjectionMatrix();
        rendererD.setSize(contenitore.clientWidth, contenitore.clientHeight);
        rendererD.render(scenaD, cameraD);
    });
}

creaFotoDettaglio('dettaglio-montatura', s => s.gruppoMateriale === 'lenti', new THREE.Vector3(0.1, 0.05, 1).normalize());
creaFotoDettaglio('dettaglio-lenti', s => s.gruppoMateriale === 'montatura' && s.lato === 'fronte', new THREE.Vector3(0.4, 0.3, 0.9).normalize());
creaFotoDettaglio('dettaglio-stanghette', s => s.lato === 'dx', new THREE.Vector3(0.9, 0.25, 0.4).normalize());
