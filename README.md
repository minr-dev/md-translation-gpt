# md-translation-gpt

英語で記載されたドキュメントを ChatGPT で日本語に翻訳して保存するツールです。

md や ipynb などで作成されているドキュメントをまとめて翻訳し、出力先のディレクトリに保存します。
原文のファイルは、hash を計算して、出力先のディレクトリに json で出力するようになっているので、
原文の更新を検出して、更新差分のみを再翻訳することが可能です。
hash を記録した json を含めて、出力先のディレクトリを、git で管理することをお勧めします。

また、翻訳文には、原文を引用の形（`>`）で残したままにすることができるので、日本語を読んで、おかしいと思ったら、
原文を確認して、自分で訂正して保存すると、その訂正もそのまま維持することができます。

英文のテクニカルドキュメントを日本語で読めるのはもちろんですが、日本語で検索することができるのは便利ではないでしょうか。
特に最近は、ローカルの文書を元ネタにして ChatGPT で対話する RAG という手法が一般化しつつあるので、
ローカルの文書を日本語テキストにしておくことは、そのような対話のためにも有用ではないかと思います。

## 使い方（Docker編）

Dockerで使うのが簡単だと思います。

```bash
git clone https://github.com/minr-dev/md-translation-gpt.git
cd md-translation-gpt

export SRC_DOC_PATH=../en-product/docs
export DST_DOC_PATH=../ja-product/docs
export OPENAI_API_KEY=xxxxxxxxxxxxxxxxx

docker-compose run --rm app
```

- SRC_DOC_PATH: 原文のあるディレクトリ
- DST_DOC_PATH: 翻訳後のディレクトリ

細かいオプションの指定は、docker-compose.yml の command を書き換えて実行するとよいと思います。

## 使い方（nodejs編）

nodejs がインストールされている環境では、以下のように実行します。
nodejs は、v20 以上です。

```bash
git clone https://github.com/minr-dev/md-translation-gpt.git
cd md-translation-gpt
npm install
npm run build

export SRC_DOC_PATH=../en-product/docs
export DST_DOC_PATH=../ja-product/docs
export OPENAI_API_KEY=xxxxxxxxxxxxxxxxx

npx md-translation-gpt -p "$SRC_DOC_PATH/**/*" -o $DST_DOC_PATH -v -d
```

## オプション

md-translation-gpt のオプションは、以下の通りです。

```bash
$ npx md-translation-gpt -h
Usage: md-translation-gpt [options]

Options:
  -V, --version            output the version number
  -v, --verbose            enables verbose logging (default: false)
  -n, --name <name>        Name of the document
  -p, --pattern <pattern>  source files using a glob pattern
  -o, --output <output>    output directory
  -f, --force              overwrite existing files (default: false)
  -d, --delete             Deletes files that exist only in the output directory and not in the input directory (default: false)
  -a, --accuracy <number>  set translation accuracy threshold (default: 0.97)
  --no-quote               Remove the original text from the translation
  -h, --help               display help for command
```

- -n, --name: ドキュメントの名前を指定します。（例）LangChainのマニュアル
- -p, --pattern: 原文のファイルを glob パターンで指定します。（例）../en-product/docs/**/*
- -o, --output: 翻訳後のファイルを出力するディレクトリを指定します。
- -f, --force: 出力先に同名のファイルが存在する場合に、上書きするかどうかを指定します。デフォルトは false です。
- -d, --delete: 出力先にあって、入力先にないファイルを削除するかどうかを指定します。デフォルトは false です。
- -a, --accuracy: 翻訳精度を指定します。0.0 から 1.0 の範囲で指定します。デフォルトは 0.97 です。
- --no-quote: デフォルトでは原文を引用の形式で翻訳結果の中に残しますが、このオプションを指定することで原文は出力されません。

## 注意

このツールは、OpenAI の API を利用します。
文章を md の heading と paragraph のノード単位に細かく分割して、それぞれを翻訳して結合して出力します。
1つのファイルを翻訳するのに、API を複数回呼び出すので、API の利用料金がかかります。

## デバッグ

VSCode を使っている場合、JavaScript Debug Terminal で以下のように実行すると、デバッグできます。

```bash
node --loader ts-node/esm src/main.ts 
```
