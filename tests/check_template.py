"""Validate the deployment contract without requiring an Unraid server."""
import xml.etree.ElementTree as ET

root = ET.parse('unraid/my-JellyHub.xml').getroot()
assert root.findtext('Repository') == 'ghcr.io/arnas1111/jellyhub:dev'
assert root.findtext('Network') == 'docker_external'
assert root.findtext('WebUI') == 'http://[IP]:[PORT:3000]/'
assert root.findtext('Privileged') == 'false'
configs = root.findall('Config')
port = next(c for c in configs if c.get('Type') == 'Port')
assert port.get('Target') == '3000' and port.text == '3100'
assert port.get('Mode') == 'tcp'
storage = next(c for c in configs if c.get('Type') == 'Path')
assert storage.get('Target') == '/config' and storage.get('Mode') == 'rw'
assert storage.text == '/mnt/user/appdata/jellyhub'
assert not any('KEY' in c.get('Target', '') for c in configs)
print('Unraid template contract passed')
