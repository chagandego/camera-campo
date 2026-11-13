// Configurações gerais do app. O nome ainda não foi escolhido:
// quando decidir, troque aqui, no manifest.webmanifest e no <title> do index.html.
export const APP_NAME = 'Projeto sem nome';

export const CAMERA = {
  // Resolução pedida à câmera (o aparelho entrega a mais próxima que suportar).
  width: 1920,
  height: 1440,
};

export const STAMP = {
  datum: 'SIRGAS 2000',   // texto exibido ao lado da coordenada UTM
  showUTM: true,          // mostra a linha UTM (E/N) no carimbo
  fontScale: 0.024,       // tamanho da letra em relação ao menor lado da foto
  jpegQuality: 0.9,
  maxSize: 4096,          // maior lado da foto salva (px)
};

export const GEO = {
  // Distância (m) que a pessoa precisa andar para o endereço ser buscado de novo.
  refetchDistance: 20,
  // Endereço só é usado na foto se foi buscado a até esta distância (m) do ponto da foto.
  maxAddressDistance: 35,
};
