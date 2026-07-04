# Acceso a Postgres desde DBeaver

Postgres no esta expuesto publicamente. Para conectarse desde DBeaver, usar un tunel SSH hacia el VPS.

## Conexion principal

- Driver: PostgreSQL
- Host: `localhost`
- Port: `15432`
- Database: `trabajoya`
- Username: `trabajoya_dbeaver`
- Password: pedir el valor temporal generado para DBeaver

## SSH tunnel

En una terminal local:

```bash
ssh -L 15432:127.0.0.1:15432 debian@<ip-del-vps>
```

Luego mantener esa terminal abierta mientras se usa DBeaver.

## Alternativa usando DBeaver

En la conexion de DBeaver, abrir la pestana `SSH` o `SSH Tunnel`:

- Use SSH Tunnel: activado
- Host/IP: `<ip-del-vps>`
- Port: `22`
- User Name: `debian`
- Authentication Method: `Password`

En la pestana principal de Postgres:

- Host: `127.0.0.1`
- Port: `15432`
- Database: `trabajoya`
- Username: `trabajoya_dbeaver`

## Notas

- No abrir el puerto `5432` en internet.
- El VPS tiene un puente local Docker `trabajoya-postgres-tunnel` publicado solo en `127.0.0.1:15432`.
- No usar el Postgres interno de Dokploy para TrabajoYA.
- La base correcta es la del stack de n8n: `trabajoya`.
