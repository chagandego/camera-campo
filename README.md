# Projeto sem nome — câmera de campo

**Abrir no celular:** https://chagandego.github.io/camera-campo/

App de celular para a equipe de obra. Abre direto na câmera e cada foto sai com um carimbo embaixo:

```
PV-12                                          ← identificação (opcional)
Rua Santa Teresa, 120 – Glicério               ← logradouro, número, bairro
São Paulo – SP  ·  CEP 01016-020
Lat -23.550520   Long -46.633308   ±4 m        ← coordenada + precisão do GPS
UTM 23S   E 333287.12   N 7394586.09   SIRGAS 2000
13/11/2026   14:06:04                          ← data e hora
```

As fotos ficam numa **galeria dentro do app**. De lá dá para salvar na galeria do celular, mandar (WhatsApp, e-mail…), editar ou excluir.

## Como funciona

| Parte | O que faz |
|---|---|
| Câmera | Câmera traseira ao vivo, com prévia do carimbo exatamente como vai sair. Lanterna quando o aparelho permite (útil dentro de PV). |
| GPS | Mostra a precisão (verde ≤ 10 m, amarelo ≤ 30 m, vermelho acima). |
| Endereço | OpenStreetMap (gratuito) para rua, número, bairro e cidade. Se faltar o CEP, ele é buscado no ViaCEP pelo nome da rua e pela faixa de numeração. Se a rua tiver vários CEPs e o número não for conhecido, aparece "(aprox.)". |
| Sem internet | A foto é salva com coordenada, data e hora. O endereço entra sozinho quando a internet voltar (a foto ganha um reloginho na galeria enquanto isso). |
| Identificação | Campo opcional (ex.: PV-01). O botão **+1** passa para o próximo número (PV-02, PV-03…). Também vai no nome do arquivo. |
| Arquivo | JPEG com o carimbo, chamado `FOTO_20261113_140604_PV-02.jpg`. As coordenadas também vão gravadas dentro do arquivo (EXIF/GPS), então a foto aparece no mapa da galeria, Google Earth, QGIS etc. |
| Galeria | Fotos agrupadas por dia. Selecionar várias (botão "Selecionar" ou toque longo no Android) para salvar, enviar ou excluir de uma vez. Um ✓ verde mostra quais já foram salvas no celular. |
| Editar | Corrige identificação e endereço (o carimbo é refeito a partir da foto original). Coordenadas, data e hora **não** podem ser alteradas. |

### Salvar na galeria do celular
- **Android:** o botão *Salvar* baixa o arquivo para a pasta **Download**, que aparece na galeria (Google Fotos → Biblioteca → Download).
- **iPhone:** o botão *Salvar* abre a folha de compartilhamento — escolha **Salvar Imagem** e a foto vai para o app Fotos.

## Tecnologia

É um **PWA** (site que se instala como app): funciona em Android e iPhone com o mesmo código, sem loja de aplicativos. A pessoa abre o endereço no Chrome/Safari e toca em **"Adicionar à tela inicial"** — a partir daí abre como um app normal, até sem internet.

Não tem dependências nem etapa de build: são arquivos HTML/CSS/JS puros.

```
index.html              telas (câmera, galeria, foto, diálogos)
css/app.css             visual
js/config.js            nome do app, resolução, tamanho do carimbo, datum
js/app.js               tela da câmera e captura
js/camera.js            acesso à câmera e lanterna
js/location.js          GPS ao vivo
js/geocode.js           endereço (OpenStreetMap) e CEP (ViaCEP)
js/geo.js               conversão para UTM e distâncias
js/stamp.js             desenho do carimbo
js/exif.js              grava coordenadas/data dentro do JPEG
js/photos.js            salvar, refazer carimbo, exportar
js/db.js                banco de fotos do app (IndexedDB)
js/gallery.js           galeria, visualização e edição
js/install.js           aviso "Instale o app no celular"
sw.js                   funcionamento offline
manifest.webmanifest    dados de instalação (nome, ícones)
tools/gerar-icones.mjs  gera os ícones PNG (node tools/gerar-icones.mjs)
```

## Rodar no computador

```bash
python -m http.server 8765
```

Abra http://localhost:8765 (no computador a câmera usada é a webcam).

## Testar no celular

A câmera e o GPS do navegador **só funcionam em endereço seguro (https)**. O app está publicado no GitHub Pages:

**https://chagandego.github.io/camera-campo/**

1. Abra o link no celular — **Chrome** no Android, **Safari** no iPhone.
2. Permita **câmera** e **localização** quando o navegador perguntar.
3. Instale na tela inicial — o próprio app mostra o aviso **"Instale o app no celular"**:
   - Android: toque em **Instalar** (se o navegador não permitir, o aviso ensina o caminho pelo menu ⋮).
   - iPhone: siga o passo a passo do aviso (Compartilhar → **Adicionar à Tela de Início**).
   - "Agora não" esconde o aviso por 1 dia. Depois de instalado, o aviso não aparece mais.

Depois de instalado, o app vira um ícone na tela do celular: abre direto na câmera, em tela cheia, sem link e sem internet.

### Publicar uma versão nova

1. Troque `VERSION` em `sw.js` (ex.: `v1` → `v2`) — é isso que faz os celulares baixarem a atualização.
2. Envie para o GitHub:

```bash
git add -A
git commit -m "Descrição da mudança"
git push
```

O GitHub Pages atualiza o link em cerca de 1 minuto. No celular, o app pega a versão nova na segunda vez que for aberto.

## Trocar o nome

Quando o nome for escolhido, altere em três lugares: `js/config.js` (`APP_NAME`), `manifest.webmanifest` (`name` e `short_name`) e `index.html` (`<title>` e `apple-mobile-web-app-title`).

## Pontos de atenção

- **Fotos ficam guardadas só naquele celular**, dentro do app. Se o app for desinstalado (ou os dados do navegador apagados), as fotos que não foram salvas na galeria se perdem. No iPhone, é importante **instalar na tela inicial**: o Safari pode limpar dados de sites que não são abertos por algumas semanas.
- **Resolução:** a foto sai na resolução do vídeo da câmera (normalmente 1440×1920, ~2,7 MP), suficiente para documentação. Pode ser aumentada em `js/config.js`.
- **Número da casa:** o OpenStreetMap nem sempre tem a numeração. Quando não tem, sai "s/nº" — dá para corrigir em *Editar*.
- **Serviço de endereço:** o OpenStreetMap público aceita até 1 consulta por segundo (o app já respeita isso). Para uma equipe grande, vale trocar por um serviço pago (Google, por exemplo) — só muda o arquivo `js/geocode.js`.
- **UTM:** calculado no elipsoide GRS80 (SIRGAS 2000). A diferença para WGS84 é milimétrica, muito abaixo da precisão do GPS do celular (3–10 m). A precisão aparece no carimbo (±m).
