# El fixture del log de mensajes — la copia del consumidor

`ejemplo.jsonl` es **byte a byte el mismo** que
[`telegram-coordinator/tests/fixtures/mensajes/`](https://github.com/stalinbeltran/telegram-coordinator/tree/main/tests/fixtures/mensajes).
No se edita aquí: se **regenera allí** —lo produce `scripts/mensajes.mjs`, no una
mano— y se copia a los dos repos en el mismo commit.

**Para qué está aquí.** Para poder probar el lector de esta web **sin arrancar el
coordinador ni tener el otro repo clonado**. Es la prueba de que este repo es una
pieza y no una carpeta del otro (R3): con esto, `DATA_DIR` apuntando a este
directorio basta para levantar la web contra datos reales.

**El formato es el contrato**, y vive donde su productor:
[`docs/log-de-mensajes.md` del coordinador](https://github.com/stalinbeltran/telegram-coordinator/blob/main/docs/log-de-mensajes.md).
Aquí se enlaza; **no se copia**, que es como nacen las dos mitades desfasadas.

Los siete casos que cubre, y que el lector tiene que saber mostrar, están
listados en el README del otro lado.
