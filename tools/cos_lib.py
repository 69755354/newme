     2|"""
     3|Unified COS access module for NewMe/Hermes.
     4|Python stdlib only — no SDK, no pip.
     5|
     6|Usage:
     7|    from cos_lib import get_tanya_client, get_newme_client
     8|
     9|    c = get_newme_client()
    10|    items = c.list(prefix='some/prefix/')
    11|    c.download('key.txt', '/tmp/key.txt')
    12|    c.upload('key.txt', b'hello', content_type='text/plain')
    13|    c.exists('key.txt')
    14|    url = c.get_url('key.txt', expires=3600)
    15|    c.delete('key.txt')
    16|"""
    17|
    18|import hashlib
    19|import hmac
    20|import os
    21|import time
    22|import urllib.parse
    23|import urllib.request
    24|from xml.etree import ElementTree as ET
    25|
    26|# ---------------------------------------------------------------------------
    27|# Env loader
    28|# ---------------------------------------------------------------------------
_ENV_FILE = os.environ.get("NEWME_ENV_FILE", os.path.join(os.path.expanduser("~"), ".newme", ".env"))
    30|
    31|
    32|def _load_env():
    33|    """Load .env into os.environ if not already present."""
    34|    if os.environ.get("_COS_ENV_LOADED"):
    35|        return
    36|    try:
    37|        with open(_ENV_FILE) as f:
    38|            for line in f:
    39|                line = line.strip()
    40|                if not line or line.startswith("#") or "=" not in line:
    41|                    continue
    42|                key, _, val = line.partition("=")
    43|                key = key.strip()
    44|                val = val.strip()
    45|                if key and key not in os.environ:
    46|                    os.environ[key] = val
    47|    except FileNotFoundError:
    48|        pass
    49|    os.environ["_COS_ENV_LOADED"] = "1"
    50|
    51|
    52|# ---------------------------------------------------------------------------
    53|# Signing helpers
    54|# ---------------------------------------------------------------------------
    55|
    56|def _sign_and_auth(secret_id: str, secret_key: str, method: str,
    57|                   uri: str, host: str,
    58|                   query_params: dict | None = None,
    59|                   duration: int = 3600) -> str:
    60|    """
    61|    Build a full COS V1 Authorization header value.
    62|
    63|    ``uri`` is the *unencoded* object path (e.g. ``/foo bar.txt``).
    64|    ``query_params`` is an optional dict of query parameters to include
    65|    in the signed URL param list (e.g. ``{"prefix": "abc/"}``).
    66|    """
    67|    method = method.lower()
    68|    start = int(time.time())
    69|    sign_time = f"{start};{start + duration}"
    70|
    71|    sign_key = hmac.new(
    72|        secret_key.encode(), sign_time.encode(), hashlib.sha1
    73|    ).hexdigest()
    74|
    75|    # Build the canonical query string for signing:
    76|    # keys sorted, lowercased; values URL-encoded
    77|    if query_params:
    78|        sorted_params = sorted(
    79|            (k.lower(), urllib.parse.quote(str(v), safe=""))
    80|            for k, v in query_params.items()
    81|        )
    82|        params_str = "&".join(f"{k}={v}" for k, v in sorted_params)
    83|        param_list = ";".join(k for k, _ in sorted_params)
    84|    else:
    85|        params_str = ""
    86|        param_list = ""
    87|
    88|    http_string = f"{method}\n{uri}\n{params_str}\nhost={host}\n"
    89|    sha1_http = hashlib.sha1(http_string.encode()).hexdigest()
    90|    string_to_sign = f"sha1\n{sign_time}\n{sha1_http}\n"
    91|    signature = hmac.new(
    92|        sign_key.encode(), string_to_sign.encode(), hashlib.sha1
    93|    ).hexdigest()
    94|
    95|    return (
    96|        f"q-sign-algorithm=sha1"
    97|        f"&q-ak={secret_id}"
    98|        f"&q-sign-time={sign_time}"
    99|        f"&q-key-time={sign_time}"
   100|        f"&q-header-list=host"
   101|        f"&q-url-param-list={param_list}"
   102|        f"&q-signature={signature}"
   103|    )
   104|
   105|
   106|# ---------------------------------------------------------------------------
   107|# COSClient
   108|# ---------------------------------------------------------------------------
   109|
   110|class COSClient:
   111|    """Lightweight COS client using only Python stdlib."""
   112|
   113|    def __init__(self, bucket: str | None = None, region: str | None = None,
   114|                 secret_id: str | None = None, secret_key: str | None = None):
   115|        _load_env()
   116|
   117|        self.bucket = bucket or os.environ.get("COS_BUCKET", "")
   118|        self.region = region or os.environ.get("COS_REGION", "ap-singapore")
   119|
   120|        if secret_id and secret_key:
   121|            self.secret_id = secret_id
   122|            self.secret_key = secret_key
   123|        else:
   124|            # Try bucket-specific creds first, fall back to generic
   125|            bucket_key = self.bucket.replace("-", "_").upper()
   126|            sid_key = f"COS_SECRET_ID_{bucket_key}"
   127|            skey_key = f"COS_SECRET_KEY_{bucket_key}"
   128|            self.secret_id = (
   129|                secret_id
   130|                or os.environ.get(sid_key)
   131|                or os.environ.get("COS_SECRET_ID", "")
   132|            )
   133|            self.secret_key = (
   134|                secret_key
   135|                or os.environ.get(skey_key)
   136|                or os.environ.get("COS_SECRET_KEY", "")
   137|            )
   138|
   139|        if not self.secret_id or not self.secret_key:
   140|            raise ValueError(
   141|                f"No COS credentials found for bucket={self.bucket!r}. "
   142|                f"Set env vars or pass explicit args."
   143|            )
   144|
   145|        self.host = f"{self.bucket}.cos.{self.region}.myqcloud.com"
   146|        self.base_url = f"https://{self.host}"
   147|
   148|    # -- internal helpers --------------------------------------------------
   149|
   150|    def _auth(self, method: str, uri: str,
   151|              query_params: dict | None = None,
   152|              duration: int = 3600) -> str:
   153|        """Build an Authorization header for the given request."""
   154|        return _sign_and_auth(
   155|            self.secret_id, self.secret_key, method,
   156|            uri, self.host, query_params, duration
   157|        )
   158|
   159|    def _request(self, method: str, uri: str, *,
   160|                 body: bytes | None = None,
   161|                 headers: dict | None = None) -> urllib.request.Request:
   162|        """Build a signed Request.  ``uri`` is the *unencoded* path."""
   163|        auth = self._auth(method, uri)
   164|        encoded_uri = urllib.parse.quote(uri, safe="/")
   165|        url = self.base_url + encoded_uri
   166|
   167|        req = urllib.request.Request(url, method=method.upper(), data=body)
   168|        req.add_header("Host", self.host)
   169|        req.add_header("Authorization", auth)
   170|        if headers:
   171|            for k, v in headers.items():
   172|                req.add_header(k, v)
   173|        return req
   174|
   175|    def _do(self, req: urllib.request.Request, timeout: int = 60):
   176|        return urllib.request.urlopen(req, timeout=timeout)
   177|
   178|    # -- public API --------------------------------------------------------
   179|
   180|    def list(self, prefix: str = "") -> list[dict]:
   181|        """
   182|        List objects in the bucket.
   183|
   184|        Returns a list of dicts with keys: key, size, last_modified.
   185|        """
   186|        query_params = {"prefix": prefix} if prefix else None
   187|        auth = self._auth("GET", "/", query_params=query_params)
   188|
   189|        url = self.base_url + "/"
   190|        if prefix:
   191|            encoded_prefix = urllib.parse.quote(prefix, safe="/")
   192|            url += f"?prefix={encoded_prefix}"
   193|
   194|        req = urllib.request.Request(url, method="GET")
   195|        req.add_header("Host", self.host)
   196|        req.add_header("Authorization", auth)
   197|
   198|        resp = self._do(req, timeout=30)
   199|        xml_data = resp.read().decode("utf-8")
   200|        root = ET.fromstring(xml_data)
   201|
   202|        ns = root.tag.split("}")[0] + "}" if "}" in root.tag else ""
   203|        results = []
   204|        for contents in root.findall(f"{ns}Contents"):
   205|            key_el = contents.find(f"{ns}Key")
   206|            size_el = contents.find(f"{ns}Size")
   207|            lm_el = contents.find(f"{ns}LastModified")
   208|            results.append({
   209|                "key": key_el.text if key_el is not None else "",
   210|                "size": int(size_el.text) if size_el is not None else 0,
   211|                "last_modified": lm_el.text if lm_el is not None else "",
   212|            })
   213|        return results
   214|
   215|    def download(self, key: str, local_path: str) -> str:
   216|        """Download an object to local_path. Returns local_path."""
   217|        uri = "/" + key
   218|        req = self._request("GET", uri)
   219|        resp = self._do(req, timeout=120)
   220|        data = resp.read()
   221|        os.makedirs(os.path.dirname(os.path.abspath(local_path)), exist_ok=True)
   222|        with open(local_path, "wb") as f:
   223|            f.write(data)
   224|        return local_path
   225|
   226|    def upload(self, key: str, data_or_path, *,
   227|               content_type: str = "application/octet-stream") -> str:
   228|        """
   229|        Upload an object.  ``data_or_path`` can be bytes or a local file path (str).
   230|        Returns the ETag from the response.
   231|        """
   232|        if isinstance(data_or_path, (bytes, bytearray)):
   233|            body = bytes(data_or_path)
   234|        else:
   235|            # treat as local file path
   236|            with open(data_or_path, "rb") as f:
   237|                body = f.read()
   238|
   239|        uri = "/" + key
   240|        req = self._request("PUT", uri, body=body,
   241|                            headers={"Content-Type": content_type})
   242|        resp = self._do(req, timeout=60)
   243|        etag = resp.headers.get("ETag", "")
   244|        return etag
   245|
   246|    def exists(self, key: str) -> bool:
   247|        """Check if an object exists (HEAD request)."""
   248|        uri = "/" + key
   249|        req = self._request("HEAD", uri)
   250|        try:
   251|            resp = self._do(req, timeout=15)
   252|            return resp.status == 200
   253|        except urllib.error.HTTPError as e:
   254|            if e.code == 404:
   255|                return False
   256|            raise
   257|
   258|    def get_url(self, key: str, expires: int = 3600) -> str:
   259|        """
   260|        Generate a presigned download URL.
   261|        """
   262|        uri = "/" + key
   263|        auth = self._auth("GET", uri, duration=expires)
   264|
   265|        encoded_uri = urllib.parse.quote(uri, safe="/")
   266|        url = f"{self.base_url}{encoded_uri}"
   267|        # Move auth params from header format to query string
   268|        url += "?" + auth
   269|        return url
   270|
   271|    def delete(self, key: str) -> bool:
   272|        """Delete an object. Returns True on success."""
   273|        uri = "/" + key
   274|        req = self._request("DELETE", uri)
   275|        try:
   276|            resp = self._do(req, timeout=15)
   277|            return resp.status in (200, 204)
   278|        except urllib.error.HTTPError as e:
   279|            if e.code == 404:
   280|                return False
   281|            raise
   282|
   283|
   284|# ---------------------------------------------------------------------------
   285|# Convenience functions
   286|# ---------------------------------------------------------------------------
   287|
   288|def get_tanya_client() -> COSClient:
   289|    """Return a COSClient for the tanya bucket (ap-guangzhou)."""
   290|    return COSClient(
   291|        bucket="tanya-1420640156",
   292|        region="ap-guangzhou",
   293|    )
   294|
   295|
   296|def get_newme_client() -> COSClient:
   297|    """Return a COSClient for the newme bucket (ap-singapore)."""
   298|    return COSClient(
   299|        bucket="newme-1302961787",
   300|        region="ap-singapore",
   301|    )
   302|
   303|
   304|# ---------------------------------------------------------------------------
   305|# CLI (python3 cos_lib.py list [--prefix X] [--bucket tanya|newme])
   306|# ---------------------------------------------------------------------------
   307|
   308|if __name__ == "__main__":
   309|    import sys
   310|
   311|    def usage():
   312|        print("Usage: cos_lib.py <command> [args]")
   313|        print("Commands:")
   314|        print("  list [--prefix PFX] [--bucket tanya|newme]")
   315|        print("  download <key> <local_path> [--bucket ...]")
   316|        print("  upload <key> <local_file> [--bucket ...]")
   317|        print("  exists <key> [--bucket ...]")
   318|        print("  url <key> [--expires N] [--bucket ...]")
   319|        print("  delete <key> [--bucket ...]")
   320|        sys.exit(1)
   321|
   322|    if len(sys.argv) < 2:
   323|        usage()
   324|
   325|    cmd = sys.argv[1]
   326|    args = sys.argv[2:]
   327|
   328|    def _parse_args(args):
   329|        bucket_name = None
   330|        positional = []
   331|        i = 0
   332|        while i < len(args):
   333|            if args[i] == "--prefix":
   334|                positional.append(args[i])
   335|                i += 1
   336|                positional.append(args[i])
   337|            elif args[i] == "--bucket":
   338|                bucket_name = args[i + 1]
   339|                i += 1
   340|            elif args[i] == "--expires":
   341|                i += 1  # skip
   342|            else:
   343|                positional.append(args[i])
   344|            i += 1
   345|        if bucket_name == "tanya":
   346|            client = get_tanya_client()
   347|        elif bucket_name == "newme":
   348|            client = get_newme_client()
   349|        else:
   350|            client = get_newme_client()
   351|        return client, positional
   352|
   353|    client, pos = _parse_args(args)
   354|
   355|    if cmd == "list":
   356|        prefix = ""
   357|        if "--prefix" in pos:
   358|            idx = pos.index("--prefix")
   359|            prefix = pos[idx + 1]
   360|        items = client.list(prefix=prefix)
   361|        for item in items:
   362|            print(f"  {item['key']}  ({item['size']} bytes)  {item['last_modified']}")
   363|        print(f"Total: {len(items)} objects")
   364|
   365|    elif cmd == "download":
   366|        if len(pos) < 2:
   367|            print("Usage: cos_lib.py download <key> <local_path>")
   368|            sys.exit(1)
   369|        path = client.download(pos[0], pos[1])
   370|        print(f"Downloaded to {path}")
   371|
   372|    elif cmd == "upload":
   373|        if len(pos) < 2:
   374|            print("Usage: cos_lib.py upload <key> <local_file>")
   375|            sys.exit(1)
   376|        etag = client.upload(pos[0], pos[1])
   377|        print(f"Uploaded. ETag: {etag}")
   378|
   379|    elif cmd == "exists":
   380|        if len(pos) < 1:
   381|            print("Usage: cos_lib.py exists <key>")
   382|            sys.exit(1)
   383|        print(client.exists(pos[0]))
   384|
   385|    elif cmd == "url":
   386|        if len(pos) < 1:
   387|            print("Usage: cos_lib.py url <key>")
   388|            sys.exit(1)
   389|        print(client.get_url(pos[0]))
   390|
   391|    elif cmd == "delete":
   392|        if len(pos) < 1:
   393|            print("Usage: cos_lib.py delete <key>")
   394|            sys.exit(1)
   395|        print(client.delete(pos[0]))
   396|
   397|    else:
   398|        usage()
   399|