# Gelbooru 标签库

脚本在 gelbooru.com 上用的标签数据：每个标签的分类、帖子数、中文名、别名和简介。界面上的中文标签名和我们自己的标签搜索都从这里查。

## 文件

- `gelbooru-tags.<版本>.tsv.gz`：标签包，gzip 压缩的 UTF-8 TSV。第一行是表头 `#ppixiv-gelbooru-tags 1`，之后一行一个标签，按帖子数从多到少排。列依次是：
  - `tag`：Gelbooru 上的写法，如 `hatsune_miku`
  - `category`：Gelbooru 的分类，0 普通、1 画师、3 作品、4 角色、5 元数据
  - `count`：截至 2026-06-11 的帖子数
  - `zh`：中文名，没有翻译时为空
  - `aliases`：别名，用 `|` 分隔
  - `notes`：中文简介，可能为空
- `gelbooru-tags.json`：清单，写着版本、生成日期、行数、文件名和大小、两个数据来源。

收录规则：Gelbooru 上帖子数不少于 50 的标签，加上有中文翻译且 Gelbooru 上存在的全部标签；去掉 Gelbooru 标为 invalid（2）和 deprecated（6）的标签。两边分类不一致时以 Gelbooru 为准。原数据里还留着 HTML 转义的名字（如 `miqo&#039;te`）会先解码，它们都是真实标签的低频重复项，解码后并入原标签；名字里带空白（制表符、换行、全角空格）的标签没法在 Gelbooru 上搜，直接丢掉。

版本号是解压后内容的 SHA-256 前 12 位，写在文件名里，所以同一个 URL 的内容永远不变。脚本 `web/vview/sites/gelbooru/tag-library.js` 里的 `PACK_VERSION` 必须和清单的 `version` 一致（`test/tag-library.mjs` 会检查），它从下面的地址下载一次，之后存在浏览器的 IndexedDB 里：

```
https://raw.githubusercontent.com/Stevey233/ppixiv-next/stevey/data/gelbooru-tags.<版本>.tsv.gz
```

设置项 `gelbooru_tag_pack_url` 可以换成别的地址（比如本地测试）。缓存按 URL 区分，同一个 URL 不会重新下载，换了内容要换 URL。

## 重新生成

两份原始数据放在 `~/.cache/ppixiv/tagdata/`，然后在仓库根目录运行：

```sh
UV_CACHE_DIR=~/.cache/uv uv run -q --no-project --with pyarrow python -I tools/build-gelbooru-tags.py \
    ~/.cache/ppixiv/tagdata/gel/gelbooru_tags.parquet ~/.cache/ppixiv/tagdata/zh
```

同样的输入两次生成的文件逐字节相同。内容变了的话，旧版本的 `.tsv.gz` 会被删掉，清单的日期更新为当天；记得把新版本号填进 `PACK_VERSION`。

## 来源和许可

### Gelbooru 标签（Apache-2.0）

标签名、分类和帖子数来自 DraconicDragon 的数据集 Gelbooru-Tags-Full_2026-06-11：<https://huggingface.co/datasets/DraconicDragon/Gelbooru-Tags-Full_2026-06-11>，按 Apache License 2.0 授权（<https://www.apache.org/licenses/LICENSE-2.0>）。本目录的标签包是它的改编作品，改动如下：只保留上面说的那部分标签，解码了 HTML 转义，合并了重复的名字，去掉了 `tag_id` 和 `is_ambiguous` 两列，并加入了下面那份数据的中文名、别名和简介。

### 中文翻译（MIT）

`zh`、`aliases`、`notes` 三列来自 amenorira 的数据集 danbooru-tags-data-zh：<https://huggingface.co/datasets/ame-la/danbooru-tags-data-zh>，按 MIT 许可授权，许可原文如下：

```
MIT License

Copyright (c) 2026 amenorira

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
