# Mapa-EM

Aplicación web ligera para visualizar comparables de estudios de mercado en un
mapa interactivo a partir de un Excel.

## Uso

1. Abre `index.html` en tu navegador (no requiere servidor ni dependencias).
2. Pulsa **«Seleccionar archivo»** y elige un `.xlsx` que contenga la hoja
   `EEMM` con las columnas `COORD`, `Promoción`, `dirección`, `unidades`, `pvp`,
   `VRM SCIC`, `nº dorm`, `Ref`, `Link`, `Tipología` y `planta`.
3. Mientras se procesa el archivo verás una barra de progreso. Al finalizar, los
   registros se agrupan por el código de comparable (`Ref`), se calcula el
   promedio unitario de `VRM SCIC` para cada grupo y se muestran los resultados
   como marcadores sobre el mapa y como tarjetas de resumen fuera del mapa.
4. Usa la lista lateral para centrar el mapa en cualquier comparable o pulsa
   **«Limpiar»** para volver al estado inicial.

El mapa arranca centrado en Cataluña y utiliza cartografía de OpenStreetMap.
