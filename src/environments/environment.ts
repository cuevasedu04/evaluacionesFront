// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  bypassLogin: false, // ESTA VARIABLE MANTIENE TU SESIÓN DE DESARROLLO SIEMPRE ACTIVA (BORRAR O PONER FALSE EN PRODUCCIÓN)
  bypassRole: 4, // Puedes cambiar aquí el rol con el que quieres probar (ej. 1, 2, 3, 4, 9999)
/*   baseurl: 'https://codecosep.sep.gob.mx:9011/', */
  baseurl: 'http://localhost:8000/',
  baseurlAssets: '',
  urlCartaConducta: "http://www.sep.gob.mx/comunicacioninterna/Codigo_de_conducta_para_las_personas_servidoras_publicas_de_la_sep_2020.pdf",
  urlAvisoPrivacidad: "http://168.255.101.89:9011/public/cartaConducta/Aviso_de_privacidad.pdf"
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/dist/zone-error';  // Included with Angular CLI.
