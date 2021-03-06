import parser from "./parser";
import { Value } from "slate";
import { Record } from "immutable";
import { encode } from "./urls";

const String = new Record({
  object: "string",
  text: ""
});

/**
 * Rules to (de)serialize nodes.
 *
 * @type {Object}
 */

let tableHeader = "";

const RULES = [
  {
    serialize(obj, children) {
      if (obj.object === "string") {
        return children;
      }
    }
  },
  {
    serialize(obj, children, document) {
      if (obj.object !== "block") return;
      let parent = document.getParent(obj.key);

      // add newline after blocks which must be separated by
      // newlines - i.e. paragraphs, blockquotes and lists.
      const addNewLine = (children) => {
        if (document.getNextSibling(obj.key)) {
          return children + "\n\n";
        }
        else {
          return children;
        }
      };

      switch (obj.type) {
        case "table":
          tableHeader = "";

          // trim removes trailing newline
          return children.trim();
        case "table-head": {
          switch (obj.getIn(["data", "align"])) {
            case "left":
              tableHeader += "|:--- ";
              break;
            case "center":
              tableHeader += "|:---:";
              break;
            case "right":
              tableHeader += "| ---:";
              break;
            default:
              tableHeader += "| --- ";
          }
          return `| ${children} `;
        }
        case "table-row":
          let output = "";
          if (tableHeader) {
            output = `${tableHeader}|\n`;
            tableHeader = "";
          }
          return `${children}|\n${output}`;
        case "table-cell":
          return `| ${children} `;
        case "paragraph":
          return addNewLine(`${children}`);
        case "code":
          return addNewLine(`\`\`\`\n${children}\n\`\`\``);
        case "code-line":
          return `${children}\n`;
        case "block-quote":
          return addNewLine(`${children.replace(/^/gm, "> ")}`);
        case "todo-list":
        case "bulleted-list":
        case "ordered-list":
          if (parent === document) {
            return children;
          }
          return `\n${addNewLine(children.replace(/^/gm, "   "))}`;
        case "list-item": {
          switch (parent.type) {
            case "ordered-list":
              return `1. ${children}\n`;
            case "todo-list":
              let checked = obj.getIn(["data", "checked"]);
              let box = checked ? "[x]" : "[ ]";
              return `${box} ${children}\n`;
            default:
            case "bulleted-list":
              return `* ${children}\n`;
          }
        }
        case "heading1":
          return `\n${children.replace(/^/gm, "# ")}\n`;
        case "heading2":
          return `\n${children.replace(/^/gm, "## ")}\n`;
        case "heading3":
          return `\n${children.replace(/^/gm, "### ")}\n`;
        case "heading4":
          return `\n${children.replace(/^/gm, "#### ")}\n`;
        case "heading5":
          return `\n${children.replace(/^/gm, "##### ")}\n`;
        case "heading6":
          return `\n${children.replace(/^/gm, "###### ")}\n`;
        case "horizontal-rule":
          return `---`;
        case "image":
          const alt = obj.getIn(["data", "alt"]);
          const src = encode(obj.getIn(["data", "src"]) || "");
          return `![${alt}](${src})`;
      }
    }
  },
  {
    serialize(obj, children) {
      if (obj.object !== "inline") return;
      switch (obj.type) {
        case "link":
          const href = encode(obj.getIn(["data", "href"]) || "");
          return href ? `[${children.trim()}](${href})` : children.trim();
      }
    }
  },
  // Add a new rule that handles marks...
  {
    serialize(obj, children) {
      if (obj.object !== "mark") return;
      switch (obj.type) {
        case "bold":
          return `**${children}**`;
        case "italic":
          return `_${children}_`;
        case "code":
          return `\`${children}\``;
        case "inserted":
          return `++${children}++`;
        case "deleted":
          return `~~${children}~~`;
      }
    }
  }
];

/**
 * Markdown serializer.
 *
 * @type {Markdown}
 */

class Markdown {
  /**
   * Create a new serializer with `rules`.
   *
   * @param {Object} options
   *   @property {Array} rules
   * @return {Markdown} serializer
   */

  constructor(options = {}) {
    this.rules = [...(options.rules || []), ...RULES];

    this.serializeNode = this.serializeNode.bind(this);
    this.serializeLeaves = this.serializeLeaves.bind(this);
    this.serializeString = this.serializeString.bind(this);
  }

  /**
   * Serialize a `state` object into an HTML string.
   *
   * @param {State} state
   * @return {String} markdown
   */

  serialize(state) {
    const { document } = state;
    const elements = document.nodes.map(node =>
      this.serializeNode(node, document)
    );

    const output = elements.join("\n");

    // trim beginning whitespace
    return output.replace(/^\s+/g, "");
  }

  /**
   * Serialize a `node`.
   *
   * @param {Node} node
   * @return {String}
   */

  serializeNode(node, document) {
    if (node.object == "text") {
      const leaves = node.getLeaves();
      const inCodeBlock = !!document.getClosest(
        node.key, (n)=>{ n.type === 'code' }
      );
      return leaves.map(this.serializeLeaves, !inCodeBlock);
    }

    let children = node.nodes.map(node => this.serializeNode(node, document));
    children = children.flatten().size === 0
      ? ""
      : children.flatten().join("");

    for (const rule of this.rules) {
      if (!rule.serialize) continue;
      const ret = rule.serialize(node, children, document);
      if (ret) return ret;
    }
  }

  /**
   * Serialize `leaves`.
   *
   * @param {Leave[]} leaves
   * @return {String}
   */

  serializeLeaves(leaves, escape) {
    let leavesText = leaves.text;
    if (escape) {
      // escape markdown characters
      leavesText = leavesText.replace(/([\\`*{}\[\]()#+\-.!_>])/gi, "\\$1");
    }
    const string = new String({ text: leavesText });
    const text = this.serializeString(string);

    return leaves.marks.reduce((children, mark) => {
      for (const rule of this.rules) {
        if (!rule.serialize) continue;
        const ret = rule.serialize(mark, children);
        if (ret) return ret;
      }
    }, text);
  }

  /**
   * Serialize a `string`.
   *
   * @param {String} string
   * @return {String}
   */

  serializeString(string) {
    for (const rule of this.rules) {
      if (!rule.serialize) continue;
      const ret = rule.serialize(string, string.text);
      if (ret) return ret;
    }
  }

  /**
   * Deserialize a markdown `string`.
   *
   * @param {String} markdown
   * @return {State} state
   */
  deserialize(markdown) {
    const document = parser.parse(markdown);
    const state = Value.fromJSON({ document });
    return state;
  }
}

export default Markdown;
