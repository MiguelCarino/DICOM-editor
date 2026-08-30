/* ============================================================
   i18n for the Electron shell (main process).
   ------------------------------------------------------------
   The editor translates itself in the renderer through carino-lang.js
   + i18n.js. That machinery cannot reach the shell: the application
   menu and the update dialogs are drawn by the OS, outside any served
   page, so they have no cookie, no localStorage and no DOM to hook.

   This module is the shell's own tiny dictionary. It resolves once from
   `app.getLocale()` — Electron fixes the locale at launch, so there is
   nothing to re-render — using the same five languages and the same
   prefix matching as carino-lang.js. English source strings are the
   keys, so a missing entry falls back to English exactly as elsewhere.

   Menu items built from Electron roles (File, Edit, View, Window) are
   deliberately absent: Electron already ships those labels localised,
   and a second translation of "Paste" would only ever disagree with the
   platform's own.
   ============================================================ */
"use strict";

const STRINGS = {
    es: {
        // First-run update opt-in
        'Should Carino DICOM Editor check GitHub for new versions once a day?': '¿Debe Carino DICOM Editor consultar GitHub una vez al día para ver si hay versiones nuevas?',
        'Nothing is sent, downloaded or installed — it only reads the number of the latest release.': 'No se envía, descarga ni instala nada: solo se lee el número de la última versión publicada.',
        'Check for updates': 'Buscar actualizaciones',
        "Don't check": 'No buscar',
        // Help menu
        'Check for updates now': 'Buscar actualizaciones ahora',
        'Check for updates automatically': 'Buscar actualizaciones automáticamente',
        'Carino DICOM Editor on GitHub': 'Carino DICOM Editor en GitHub',
        'Licence (AGPL-3.0)': 'Licencia (AGPL-3.0)',
        // Result of a check the user asked for by hand
        'No update available': 'No hay actualizaciones',
        'You are running the newest version, {version}.': 'Estás usando la versión más reciente, {version}.',
        'An update is available': 'Hay una actualización disponible',
        'Version {version} has been released. You are running {current}.': 'Se publicó la versión {version}. Estás usando la {current}.',
        'Open release page': 'Abrir la página de la versión',
        'Close': 'Cerrar',
        'Could not check for updates': 'No se pudieron buscar actualizaciones',
        'GitHub could not be reached. Nothing was changed; try again later.': 'No se pudo conectar con GitHub. No se cambió nada; inténtalo más tarde.',
    },
    'pt-BR': {
        'Should Carino DICOM Editor check GitHub for new versions once a day?': 'O Carino DICOM Editor deve consultar o GitHub uma vez por dia em busca de novas versões?',
        'Nothing is sent, downloaded or installed — it only reads the number of the latest release.': 'Nada é enviado, baixado ou instalado — apenas o número da última versão publicada é lido.',
        'Check for updates': 'Procurar atualizações',
        "Don't check": 'Não procurar',
        'Check for updates now': 'Procurar atualizações agora',
        'Check for updates automatically': 'Procurar atualizações automaticamente',
        'Carino DICOM Editor on GitHub': 'Carino DICOM Editor no GitHub',
        'Licence (AGPL-3.0)': 'Licença (AGPL-3.0)',
        'No update available': 'Nenhuma atualização disponível',
        'You are running the newest version, {version}.': 'Você está usando a versão mais recente, {version}.',
        'An update is available': 'Há uma atualização disponível',
        'Version {version} has been released. You are running {current}.': 'A versão {version} foi publicada. Você está usando a {current}.',
        'Open release page': 'Abrir a página da versão',
        'Close': 'Fechar',
        'Could not check for updates': 'Não foi possível procurar atualizações',
        'GitHub could not be reached. Nothing was changed; try again later.': 'Não foi possível acessar o GitHub. Nada foi alterado; tente novamente mais tarde.',
    },
    ja: {
        'Should Carino DICOM Editor check GitHub for new versions once a day?': 'Carino DICOM Editor が新しいバージョンを GitHub に 1 日 1 回確認してもよいですか？',
        'Nothing is sent, downloaded or installed — it only reads the number of the latest release.': '送信・ダウンロード・インストールは一切行わず、最新リリースの番号を読むだけです。',
        'Check for updates': '更新を確認する',
        "Don't check": '確認しない',
        'Check for updates now': '今すぐ更新を確認',
        'Check for updates automatically': '自動的に更新を確認',
        'Carino DICOM Editor on GitHub': 'Carino DICOM Editor を GitHub で見る',
        'Licence (AGPL-3.0)': 'ライセンス (AGPL-3.0)',
        'No update available': '更新はありません',
        'You are running the newest version, {version}.': '最新バージョン {version} を使用しています。',
        'An update is available': '更新があります',
        'Version {version} has been released. You are running {current}.': 'バージョン {version} が公開されました。現在お使いのバージョンは {current} です。',
        'Open release page': 'リリースページを開く',
        'Close': '閉じる',
        'Could not check for updates': '更新を確認できませんでした',
        'GitHub could not be reached. Nothing was changed; try again later.': 'GitHub に接続できませんでした。何も変更されていません。しばらくしてからもう一度お試しください。',
    },
    ru: {
        'Should Carino DICOM Editor check GitHub for new versions once a day?': 'Разрешить Carino DICOM Editor раз в сутки проверять на GitHub наличие новых версий?',
        'Nothing is sent, downloaded or installed — it only reads the number of the latest release.': 'Ничего не отправляется, не скачивается и не устанавливается — читается только номер последнего выпуска.',
        'Check for updates': 'Проверять обновления',
        "Don't check": 'Не проверять',
        'Check for updates now': 'Проверить обновления сейчас',
        'Check for updates automatically': 'Проверять обновления автоматически',
        'Carino DICOM Editor on GitHub': 'Carino DICOM Editor на GitHub',
        'Licence (AGPL-3.0)': 'Лицензия (AGPL-3.0)',
        'No update available': 'Обновлений нет',
        'You are running the newest version, {version}.': 'Установлена самая новая версия, {version}.',
        'An update is available': 'Доступно обновление',
        'Version {version} has been released. You are running {current}.': 'Выпущена версия {version}. У вас установлена {current}.',
        'Open release page': 'Открыть страницу выпуска',
        'Close': 'Закрыть',
        'Could not check for updates': 'Не удалось проверить обновления',
        'GitHub could not be reached. Nothing was changed; try again later.': 'Не удалось соединиться с GitHub. Ничего не изменено; попробуйте позже.',
    },
};

// Same prefix matching as carino-lang.js, so the shell and the page agree on
// what "pt-PT" or "es-MX" resolve to.
function resolve(tag) {
    const l = String(tag || '').toLowerCase();
    if (l.startsWith('es')) return 'es';
    if (l.startsWith('pt')) return 'pt-BR';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('ru')) return 'ru';
    return 'en';
}

let dict = null;

// `app` is passed in rather than required, so this module stays testable and
// does not pull Electron in when it is only being linted.
function init(app) {
    let tag = '';
    try { tag = app.getLocale(); } catch (e) { /* pre-ready: stay English */ }
    dict = STRINGS[resolve(tag)] || null;
}

function t(key, vals) {
    const s = (dict && dict[key]) || key;
    return vals ? s.replace(/\{(\w+)\}/g, (m, k) => (vals[k] != null ? vals[k] : m)) : s;
}

module.exports = { init, t, resolve };
