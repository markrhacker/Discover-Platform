import {eve} from "./app";

declare var pluralize;

// ----------------------------------------------------------------------------
// User-Facing functions
// ----------------------------------------------------------------------------

export interface Result {
  intent: Intents,
  context: Context,
  tokens: Array<Token>,
  tree: Node,
  query: Query,
  inserts: Array<Insert>,
}

export enum NodeTypes {
  ENTITY,
  COLLECTION,
  ATTRIBUTE,
  NUMBER,
  STRING,
  FUNCTION,
}

export interface Insert {
  entity: Node,
  attribute: Node,
  value: Node|Query,
}

export enum Intents {
  QUERY,
  INSERT,
  MOREINFO,
  NORESULT,
}

// Entry point for NLQP
export function parse(queryString: string, lastParse?: Result): Array<Result> {
  let tree: Node;
  let context: Context;
  let tokens: Array<Token>;
  // If this is the first run, then create a root node.
  if (lastParse === undefined) {
    let rootToken = newToken("root");
    rootToken.properties.push(Properties.ROOT);
    tree = newNode(rootToken);
    tree.found = true;
    context = newContext();
    tokens = [rootToken];
  // Otherwise, use the previous parse tree
  } else {
    tree = lastParse.tree;
    context = lastParse.context;
    tokens = lastParse.tokens;
  }
  // Now do something with the query string
  let words = normalizeQueryString(queryString);
  for (let word of words) {
    // From a token
    let token = formToken(word);
    // Link new token with the rest
    let lastToken = tokens[tokens.length - 1];
    lastToken.next = token;
    token.prev = lastToken;
    tokens.push(token);
    // Add the token to the tree
    let node = newNode(token);
    let treeResult = formTree(node, tree, context);
    tree = treeResult.tree;
    context = treeResult.context;
  }
  // Manage context
  context.entities = context.found.filter((n) => n.hasProperty(Properties.ENTITY) && !n.hasProperty(Properties.SUBSUMED) && !n.hasProperty(Properties.IMPLICIT));
  context.collections = context.found.filter((n) => n.hasProperty(Properties.COLLECTION) && !n.hasProperty(Properties.SUBSUMED) && !n.hasProperty(Properties.IMPLICIT)); 
  context.attributes = context.found.filter((n) => n.hasProperty(Properties.ATTRIBUTE) && !n.hasProperty(Properties.SUBSUMED) && !n.hasProperty(Properties.IMPLICIT));
  context.maybeAttributes = context.maybeAttributes.filter((n) => !n.hasProperty(Properties.SUBSUMED) && !n.found);
  context.maybeCollections = context.maybeCollections.filter((n) => !n.hasProperty(Properties.SUBSUMED) && !n.found);
  context.maybeEntities = context.maybeEntities.filter((n) => !n.hasProperty(Properties.SUBSUMED) && !n.found);
  
  // Manage results
  let intent = Intents.NORESULT;
  let query = newQuery();
  let insertResults = [];
  if (allFound(tree)) {
    let inserts = context.internalFxns.filter((f) => f.fxn.type === FunctionTypes.INSERT);
    if (inserts.length > 0) {
      intent = Intents.INSERT;
      // Format each insert
      for (let insert of inserts) {
        if (insert.children.every((c) => c.found)) {
          // Collapse the result root if every node doesn't have a child
          if (insert.children[2].children.length > 1 && insert.children[2].children.every((c) => c.children.length === 0)) {
            let nName = insert.children[2].children.map((c) => c.name).join(" ");
            let nToken = newToken(nName);
            let nNode = newNode(nToken);
            nNode.found = true;
            nNode.type = NodeTypes.STRING; 
            insert.children[2].children.map(removeNode);
            insert.children[2].addChild(nNode);
          }        
          let insertResult: Insert = {
            entity: insert.children[0].children[0],
            attribute: insert.children[1].children[0],
            value: insert.children[2].children[0],
          }
          insertResults.push(insertResult);
        }
      }
    } else if (context.maybeAttributes.length > 0) {
      intent = Intents.MOREINFO;
    // This clause is to protect against product joining
    } else if (context.found.length > 1 && // product joins only occurr in the case when there is more than one thing
               ((context.attributes.filter((a) => a.attribute.refs === undefined && !a.parent.hasProperty(Properties.ARGUMENT)).length > 0) ||
               (context.collections.filter((c) => c.relationships.length === 0).length > 0))) {
      intent = Intents.NORESULT;
    } else {
      intent = Intents.QUERY;
    }
  }
  if (intent === Intents.QUERY) {
    // Create the query from the new tree
    intent = Intents.QUERY;
    log("Building query...");
    query = formQuery(tree);  
    if (query.projects.length === 0) {
      intent = Intents.NORESULT;
      query = newQuery();
    }
  }
  
  return [{intent: intent, context: context, tokens: tokens, tree: tree, query: query, inserts: insertResults}];
}

// Returns false if any nodes are not marked found
// Returns true if all nodes are marked found
function treeComplete(node: Node): boolean {
  if (node.found === false) {
    return false;
  } else {
    let childrenStatus = node.children.map(treeComplete);
    return childrenStatus.every((child) => child === true); 
  }
}

interface Word {
  ix: number;
  text: string;
}

// Performs some transformations to the query string before tokenizing
export function normalizeQueryString(queryString: string): Array<Word> {
  // Add whitespace before and after separator and operators
  let normalizedQueryString = queryString.replace(/,/g,' , ');
  normalizedQueryString = normalizedQueryString.replace(/;/g,' ; ');
  normalizedQueryString = normalizedQueryString.replace(/\+/g,' + ');
  normalizedQueryString = normalizedQueryString.replace(/\^/g,' ^ ');
  normalizedQueryString = normalizedQueryString.replace(/-/g,' - ');
  normalizedQueryString = normalizedQueryString.replace(/\*/g,' * ');
  normalizedQueryString = normalizedQueryString.replace(/\//g,' / ');
  normalizedQueryString = normalizedQueryString.replace(/"/g,' " ');
  // Split possessive endings
  normalizedQueryString = normalizedQueryString.replace(/\'s/g,' \'s ');
  normalizedQueryString = normalizedQueryString.replace(/s'/g,'s \' ');
  // Clean various symbols we don't want to deal with
  normalizedQueryString = normalizedQueryString.replace(/`|\?|\:|\[|\]|\{|\}|\(|\)|\~|\`|~|@|#|\$|%|&|_|\|/g,' ');
  // Collapse whitespace   
  normalizedQueryString = normalizedQueryString.replace(/\s+/g,' ');
  // Split words at whitespace
  let splitStrings = normalizedQueryString.split(" ");
  let words = splitStrings.map((text, i) => {return {ix: i + 1, text: text};});
  words = words.filter((word) => word.text !== "");
  return words;
}

export function normalizeString(queryString: string): string {
  // Add whitespace before and after separator and operators
  let normalized = queryString.replace(/,/g,' , ');
  normalized = normalized.replace(/;/g,' ; ');
  normalized = normalized.replace(/\+/g,' + ');
  normalized = normalized.replace(/\^/g,' ^ ');
  normalized = normalized.replace(/-/g,' - ');
  normalized = normalized.replace(/\*/g,' * ');
  normalized = normalized.replace(/\//g,' / ');
  normalized = normalized.replace(/"/g,' " ');
  // Split possessive endings
  normalized = normalized.replace(/\'s/g,' \'s ');
  normalized = normalized.replace(/s'/g,'s \' ');
  // Clean various symbols we don't want to deal with
  normalized = normalized.replace(/`|\?|\:|\[|\]|\{|\}|\(|\)|\~|\`|~|@|#|\$|%|&|_|\|/g,' ');
  // Collapse whitespace   
  normalized = normalized.replace(/\s+/g,' ');  
  normalized = normalized.toLowerCase();
  normalized = singularize(normalized);  
  return normalized;
}

// ----------------------------------------------------------------------------
// Token functions
// ----------------------------------------------------------------------------

enum MajorPartsOfSpeech {
  ROOT,
  VERB,
  ADJECTIVE,
  ADVERB,
  NOUN,
  VALUE,
  GLUE,
  WHWORD,
  SYMBOL,
}

enum MinorPartsOfSpeech {
  ROOT,
  // Verb
  VB,   // verb, generic (eat)
  VBD,  // past-tense verb (ate)
  VBN,  // past-participle verb (eaten)
  VBP,  // infinitive verb (eat)
  VBZ,  // presnt-tense verb (eats)
  VBF,  // future-tense verb (eat)
  CP,   // copula (is, was, were)
  VBG,  // gerund verb (eating)
  // Adjective
  JJ,   // adjective, generic (big)
  JJR,  // comparative adjective (bigger)
  JJS,  // superlative adjective (biggest)
  // Adverb
  RB,   // adverb, generic (quickly)
  RBR,  // comparative adverb (cooler)
  RBS,  // superlative adverb (coolest (looking))
  // Noun
  NN,   // noun, singular (dog) 
  NNPA, // acronym (FBI)
  NNAB, // abbreviation (jr.)
  NG,   // gerund noun (eating, winning, but used as a noun)
  PRP,  // personal pronoun (I, you, she)
  PP,   // possessive pronoun (my, one's)
  // Legacy Noun
  NNP,  // Singular proper noun (Smith)
  NNPS, // Plural proper noun (Smiths)
  NNO,  // Possessive noun (people's)
  NNS,  // Plural noun (people)
  NNA,  // @TODO figure out what NNA is.
  NNQ,  // Quoted text
  // Glue
  FW,   // foreign word (voila) 
  IN,   // preposition (of, in, by)
  MD,   // modal verb (can, should)
  CC,   // coordinating conjunction (and, but, or)
  PDT,  // predeterminer (some, all, any)
  DT,   // determiner (the)
  UH,   // interjection (oh, oops)
  EX,   // existential there (there)
  // Value
  CD,   // cardinal value (one, two, first)
  DA,   // date (june 5th 1998)
  NU,   // number (100, one hundred)
  // Symbol
  LT,   // Symbol (<)
  GT,   // Symbol (>)
  GTE,  // Symbol (>=)
  LTE,  // Symbol (<=)
  EQ,   // Symbol (=)
  NEQ,  // Symbol (!=)
  PLUS, // Symbol (+)
  MINUS,// Symbol (-)
  DIV,  // Symbol (/)
  MUL,  // Symbol (*)
  POW,  // Symbol (^)
  SEP,  // Separator (, ; : ")
  POS,  // Possessive ending ('s)
  // Wh- word
  WDT,  // Wh-determiner (that what whatever which whichever)
  WP,   // Wh-pronoun (that what whatever which who whom)
  WPO,  // Wh-pronoun possessive (whose)
  WRB   // Wh-adverb (however whenever where why)
}

interface Token {
  ix: number,
  start?: number,
  end?: number,
  originalWord: string,
  normalizedWord: string,
  POS: MinorPartsOfSpeech,
  properties: Array<Properties>,
  node?: Node,
  prev?: Token,
  next?: Token,
}

function newToken(text: string): Token {
  let token = formToken({ix: 0, text: text});
  token.properties.push(Properties.IMPLICIT);
  return token;
}

function cloneToken(token: Token): Token {
  let clone: Token = {
    ix: token.ix,
    originalWord: token.originalWord,
    normalizedWord: token.normalizedWord,
    POS: token.POS,
    properties: [],
  };
  token.properties.map((property) => clone.properties.push(property));
  return clone;
}

enum Properties {
  // Node properties
  ROOT,
  // EVE types
  COLLECTION,
  ENTITY,
  ATTRIBUTE,
  FUNCTION,
  QUANTITY,
  STRING,
  // Function properties  
  OUTPUT,
  INPUT,
  ARGUMENT,
  AGGREGATE,
  CALCULATE,
  OPERATOR,
  // Token properties
  PROPER,
  PLURAL,
  POSSESSIVE,
  BACKRELATIONSHIP,
  COMPARATIVE,
  SUPERLATIVE,
  PRONOUN,  
  SEPARATOR,
  CONJUNCTION,
  QUOTED,
  SETTER,
  SUBSUMED,
  COMPOUND,
  // Modifiers
  NEGATES,
  GROUPING,
  IMPLICIT,
  STOPPARSE,
}

// take an input string, extract tokens
function formToken(word: Word): Token {
  // Every word is tagged a noun unless some rule says otherwise
  let POS: MinorPartsOfSpeech = MinorPartsOfSpeech.NN;
  let properties: Array<Properties> = [];
  let originalWord = word.text;
  let normalizedWord = originalWord;
  let found = false;
  
  let upperCaseLetters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
  let lowerCaseLetters = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z'];
  let digits = ['1','2','3','4','5','6','7','8','9','0'];
  let separators = [',',':',';','"'];
  let operators = ['+','-','*','/','^'];
  let comparators = ['>','>=','<','<=','=','!='];
  
  // Most of the following vectors were taken from NLP Compromise
  // https://github.com/nlp-compromise/nlp_compromise
  // Copyright (c) 2016 Spencer Kelly: 
  // Licensed under the MIT License: https://github.com/nlp-compromise/nlp_compromise/blob/master/LICENSE.txt
  let preDeterminers = ['all'];
  let determiners = ['this', 'any', 'enough', 'each', 'every', 'these', 'another', 'plenty', 'whichever', 'neither', 'an', 'a', 'least', 'own', 'few', 'both', 'those', 'the', 'that', 'various', 'what', 'either', 'much', 'some', 'else', 'no'];
  let copulae = ['am', 'is', 'are', 'was', 'were', 'as', 'am', 'be', 'has', 'become', 'became', 'seemed', 'seems', 'seeming'];
  let conjunctions = ['yet', 'therefore', 'or', 'while', 'nor', 'whether', 'though', 'because', 'but', 'for', 'and', 'if', 'before', 'although', 'plus', 'versus', 'not'];
  let prepositions = ['with', 'until', 'onto', 'of', 'into', 'out', 'except', 'across', 'by', 'between', 'at', 'down', 'as', 'from', 'around', 'among', 'upon', 'amid', 'to', 'along', 'since', 'about', 'off', 'on', 'within', 'in', 'during', 'per', 'without', 'throughout', 'through', 'than', 'via', 'up', 'unlike', 'despite', 'below', 'unless', 'towards', 'besides', 'after', 'whereas','amongst', 'atop', 'barring', 'circa', 'mid', 'midst', 'notwithstanding', 'sans', 'thru', 'till', 'versus'];
  let possessivePronouns = ['mine', 'something', 'none', 'anything', 'anyone', 'theirs', 'himself', 'ours', 'his', 'my', 'their', 'yours', 'your', 'our', 'its', 'nothing', 'herself', 'hers', 'themselves', 'everything', 'myself', 'itself', 'her'];
  let personalPronouns = ['it', 'they', 'i', 'them', 'you', 'she', 'me', 'he', 'him', 'ourselves', 'us', 'we', 'yourself'];
  let modals = ['can', 'may', 'could', 'might', 'will', 'would', 'must', 'shall', 'should', 'ought'];
  let whPronouns = ['who', 'what', 'whom'];
  let whDeterminers = ['whatever', 'which'];
  let whPossessivePronoun = ['whose'];
  let whAdverbs = ['how', 'when', 'however', 'whenever', 'where', 'why'];   
  let verbs = ['have', 'do'];
  let adverbs = ['there'];

  // We have three cases: the word is a symbol (of which there are various kinds), a number, or a string
  
  // ----------------------
  // Case 1: handle symbols
  // ----------------------
  if (!found) {
    if (operators.indexOf(originalWord) >= 0) {
      found = true;
      properties.push(Properties.OPERATOR);
      switch (originalWord) {
        case "+":
          POS = MinorPartsOfSpeech.PLUS;
          break;
        case "-":
          POS = MinorPartsOfSpeech.MINUS;
          break;
        case "*":
          POS = MinorPartsOfSpeech.MUL;
          break;
        case "/":
          POS = MinorPartsOfSpeech.DIV;
          break;
        case "^":
          POS = MinorPartsOfSpeech.POW;
          break;
      }
    } else if (comparators.indexOf(originalWord) >= 0) {
      found = true;
      properties.push(Properties.COMPARATIVE);
      switch (originalWord) {
        case ">":
          POS = MinorPartsOfSpeech.GT;
          break;
        case ">=":
          POS = MinorPartsOfSpeech.GTE;
          break;
        case "<":
          POS = MinorPartsOfSpeech.LT;
          break;
        case "<=":
          POS = MinorPartsOfSpeech.LTE;
          break;
        case "=":
          POS = MinorPartsOfSpeech.EQ;
          break;
        case "!=":
          POS = MinorPartsOfSpeech.NEQ;
          break;
      }
    } else if (separators.indexOf(originalWord) >= 0) {
      found = true;
      properties.push(Properties.SEPARATOR);
      POS = MinorPartsOfSpeech.SEP;
      if (originalWord === `"`) {
        properties.push(Properties.QUOTED);
      }
    } else if (originalWord === "'s" || originalWord === "'") {
      properties.push(Properties.POSSESSIVE);  
      POS = MinorPartsOfSpeech.POS;    
    }
  }
  // ----------------------
  // Case 2: handle numbers
  // ----------------------
  if (!found) {
    if (digits.indexOf(originalWord[0]) >= 0 && isNumeric(originalWord)) {
      found = true;
      properties.push(Properties.QUANTITY);
      POS = MinorPartsOfSpeech.NU;
    }
  }
  // ----------------------
  // Case 3: handle strings
  // ----------------------
  if (!found) {
    // Normalize the word
    normalizedWord = normalizedWord.toLowerCase();
    let before = normalizedWord;
    normalizedWord = singularize(normalizedWord);
    if (before !== normalizedWord) {
      properties.push(Properties.PLURAL);
    }
    // Find the POS in the dictionary, apply some properties based on the word
    // Determiners
    if (determiners.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.DT;
    // Modals
    } else if (modals.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.MD;
    // Predeterminers
    } else if (preDeterminers.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.PDT;
    // Copulae
    } else if (copulae.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.CP;
    // Prepositions
    } else if (prepositions.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.IN;
    // Personal pronouns
    } else if (personalPronouns.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.PRP; 
      properties.push(Properties.PRONOUN);
    // Possessive pronouns
    } else if (possessivePronouns.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.PRP; 
      properties.push(Properties.PRONOUN);
      properties.push(Properties.POSSESSIVE);
    // Conjunctions
    } else if (conjunctions.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.CC; 
      properties.push(Properties.CONJUNCTION);
    // Wh-words
    } else if (whPronouns.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.WP; 
    } else if (whDeterminers.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.WDT; 
    } else if (whAdverbs.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.WRB; 
    } else if (whPossessivePronoun.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.WPO;
      properties.push(Properties.POSSESSIVE)
    // Verbs 
    } else if (verbs.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.VB;
    // Adverbs 
    } else if (adverbs.indexOf(normalizedWord) >= 0) {
      POS = MinorPartsOfSpeech.RB;
    }
    
    // Set grouping property
    let groupingWords = ['per', 'by'];
    let negatingWords = ['except', 'without', 'sans', 'not', 'nor', 'neither', 'no'];
    let pluralWords = ['their'];
    if (groupingWords.indexOf(normalizedWord) >= 0) {
      properties.push(Properties.GROUPING);
    // Set negate property        
    } else if (negatingWords.indexOf(normalizedWord) >= 0) {
      properties.push(Properties.NEGATES);
    // Set plural property
    } else if (pluralWords.indexOf(normalizedWord) >= 0) {
      properties.push(Properties.PLURAL);
    }
    // If the word is still a noun, if it is upper case than it is a proper noun 
    if (getMajorPOS(POS) === MajorPartsOfSpeech.NOUN) {
      if (upperCaseLetters.indexOf(originalWord[0]) >= 0) {
        properties.push(Properties.PROPER);
      }
    }
  }
  // Build the token
  let token: Token = {
    ix: word.ix, 
    originalWord: word.text, 
    normalizedWord: normalizedWord,
    POS: POS,
    properties: properties,
  };
  return token;
}

function getMajorPOS(minorPartOfSpeech: MinorPartsOfSpeech): MajorPartsOfSpeech {
  // ROOT
  if (minorPartOfSpeech === MinorPartsOfSpeech.ROOT) {
    return MajorPartsOfSpeech.ROOT;
  }
  // Verb
  let verbs = ['VB','VBD','VBN','VBP','VBZ','VBF','VBG'];
  if (verbs.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.VERB;
  }
  // Adjective
  let adjectives = ['JJ','JJR','JJS'];
  if (adjectives.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.ADJECTIVE;
  }
  // Adverb
  let adverbs = ['RB','RBR','RBS'];
  if (adverbs.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.ADVERB;
  }
  // Noun
  let nouns = ['NN','NNA','NNPA','NNAB','NNP','NNPS','NNS','NNQ','NNO','NG','PRP','PP'];
  if (nouns.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
    return MajorPartsOfSpeech.NOUN;
  }
  // Value
  let values = ['CD','DA','NU'];
  if (values.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
    return MajorPartsOfSpeech.VALUE;
  }
  // Glue
  let glues = ['FW','IN','CP','MD','CC','PDT','DT','UH','EX'];
  if (glues.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
    return MajorPartsOfSpeech.GLUE;
  }  
  // Symbol
  let symbols = ['LT','GT','LTE','GTE','EQ','NEQ',
                 'PLUS','MINUS','DIV','MUL','POW',
                 'SEP','POS'];
  if (symbols.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
    return MajorPartsOfSpeech.SYMBOL;
  }
  // Wh-Word
  let whWords = ['WDT','WP','WPO','WRB'];
  if (whWords.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
    return MajorPartsOfSpeech.WHWORD;
  }
}

// Wrap pluralize to special case certain words it gets wrong
// @HACK data singularizes to datum, which is correct, but we
// have a collection called test data, which NLQP turns into test datum
export function singularize(word: string): string {
  // split word at spaces
  let words = word.split(" ");
  if (words.length === 1) {
    let specialCases = ["his", "times", "has", "downstairs", "its", "'s", "data", "are", "was"];
    for (let specialCase of specialCases) {
      if (specialCase === word) {
        return word;
      }
    }
    return pluralize(word, 1);  
  }
  return words.map(singularize).join(" ");
}

// ----------------------------------------------------------------------------
// Tree functions
// ----------------------------------------------------------------------------

interface Node {
  ix: number,
  type?: NodeTypes,
  name: string,
  parent: Node,
  children: Array<Node>,
  entity?: Entity,
  collection?: Collection,
  attribute?: Attribute,
  fxn?: BuiltInFunction,
  quantity?: number,
  constituents?: Array<Node>,
  relationships: Array<Relationship>,
  representations: {
    collection?: Collection,
    entity?: Entity,
    attribute?: Attribute,
    fxn?: BuiltInFunction,
  },
  token: Token,
  found: boolean,
  foundReps: boolean,
  properties: Array<Properties>,
  hasProperty(Properties): boolean;
  toString(number?: number): string;
  next(): Node;
  prev(): Node;
  addChild(node: Node): void;
}

function cloneNode(node: Node): Node {
  let token = cloneToken(node.token);
  let cloneNode = newNode(token);
  cloneNode.entity = node.entity;
  cloneNode.collection = node.collection;
  cloneNode.attribute = node.attribute;
  cloneNode.fxn = node.fxn;
  cloneNode.found = node.found;
  node.properties.map((property) => cloneNode.properties.push(property));
  return cloneNode;
}

function newNode(token: Token): Node {
  let node: Node = {
    ix: token.ix,
    name: token.normalizedWord,
    parent: undefined,
    children: [],
    token: token, 
    properties: token.properties,
    relationships: [],
    representations: {
      entity: undefined,
      collection: undefined,
      attribute: undefined,
      fxn: undefined,  
    },
    found: false,
    foundReps: false,
    hasProperty: hasProperty,
    toString: nodeToString,
    next: nextNode,
    prev: previousNode,
    addChild: addChild,
  };
  token.node = node;
  function hasProperty(property: Properties): boolean {
  let found = node.properties.indexOf(property);
  if (found !== -1) {
      return true;
    } else {
      return false;
    }
  }
  function nextNode(): Node {
    let token = node.token;
    let nextToken = token.next;
    if (nextToken !== undefined) {
      return nextToken.node;
    }
    return undefined;
  }
  function previousNode(): Node {
    let token = node.token;
    let prevToken = token.prev;
    if (prevToken !== undefined) {
      return prevToken.node;
    }
    return undefined;
  }
  function addChild(newChild: Node): void {
    node.children.push(newChild);
    newChild.parent = node;
  }
  function nodeToString(depth?: number): string {
    if (depth === undefined) {
      depth = 0;
    }
    let childrenStrings = node.children.map((childNode) => childNode.toString(depth+1)).join("\n");
    let children = childrenStrings.length > 0 ? "\n" + childrenStrings : "";
    let indent = Array(depth+1).join(" ");
    let index = node.ix === undefined ? "+ " : `${node.ix}: `;
    let properties = node.properties.length === 0 ? "" : `(${node.properties.map((property: Properties) => Properties[property]).join("|")})`;
    let attribute = node.attribute === undefined ? "" : `[${node.attribute.variable}]`;
    let entity = node.entity === undefined ? "" : `[${node.entity.displayName}]`;
    let collection = node.collection === undefined ? "" : `[${node.collection.displayName}]`;
    let fxn = node.fxn === undefined ? "" : `[${node.fxn.name}]`;
    let found = node.found ? "*" : " ";
    properties = properties.length === 2 ? "" : properties;
    let nodeString = `|${found}${indent}${index}${node.name} ${fxn}${entity}${collection}${attribute} ${properties}${children}`; 
    return nodeString;
  }
  return node;  
}

//------------------------------------
// Various node manipulation functions
//------------------------------------

// Removes the node and its children from the tree, 
// and makes it a child of the target node
function reroot(node: Node, target: Node): void {
  node.parent.children.splice(node.parent.children.indexOf(node),1);  
  target.addChild(node);
}

// Removes a node from the tree
// The node's children get added to its parent
// returns the node or undefined if the operation failed
function removeNode(node: Node): Node {
  if (node.hasProperty(Properties.ROOT)) {
    return undefined;
  }
  if (node.parent === undefined && node.children.length === 0) {
    return undefined;
  }
  let children: Array<Node> = node.children;
  let parent: Node = node.parent;
  // Rewire
  if (parent !== undefined) {
    parent.children = parent.children.concat(children);
    parent.children.sort((a,b) => a.ix - b.ix);
    parent.children.splice(parent.children.indexOf(node),1);
    children.map((child) => child.parent = parent);
    if (parent.hasProperty(Properties.ARGUMENT)) {
      if (parent.children.length === 0) {
        parent.found = false;
      }
    }
  }
  // Get rid of references on current node
  node.parent = undefined;
  node.children = [];
  return node;
}

function removeBranch(node: Node): Node {
  let parent = node.parent;
  if (parent !== undefined) {
    parent.children.splice(parent.children.indexOf(node),1);
    node.parent = undefined;
    return node;  
  }
  return undefined;
}

// Returns the first ancestor node that has been found
function previouslyMatched(node: Node, ignoreFunctions?: boolean): Node {
  if (ignoreFunctions === undefined) {
    ignoreFunctions = false;
  }
  if (node.parent === undefined) {
    return undefined;
  } else if (!ignoreFunctions && 
             (node.parent.hasProperty(Properties.SETTER) ||
             (node.parent.hasProperty(Properties.FUNCTION) && !node.parent.hasProperty(Properties.CONJUNCTION))))  {
    return undefined;
  } else if (node.parent.hasProperty(Properties.ENTITY) ||
             node.parent.hasProperty(Properties.ATTRIBUTE) ||
             node.parent.hasProperty(Properties.COLLECTION)) {
    return node.parent;
  } else {
    return previouslyMatched(node.parent,ignoreFunctions);
  }
}

// Returns the first ancestor node that has been found
function previouslyMatchedEntityOrCollection(node: Node, ignoreFunctions?: boolean): Node {
  if (ignoreFunctions === undefined) {
    ignoreFunctions = false;
  }
  if (node.parent === undefined) {
    return undefined;
  } else if (!ignoreFunctions && 
             (node.parent.hasProperty(Properties.SETTER) ||
             (node.parent.hasProperty(Properties.FUNCTION) && !node.parent.hasProperty(Properties.CONJUNCTION))))  {
    return undefined;
  } else if (node.parent.hasProperty(Properties.ENTITY) ||
             node.parent.hasProperty(Properties.COLLECTION)) {
    return node.parent;
  } else {
    return previouslyMatchedEntityOrCollection(node.parent,ignoreFunctions);
  }
}

// Returns the first ancestor node that has been found
function previouslyMatchedAttribute(node: Node, ignoreFunctions?: boolean): Node {
  if (ignoreFunctions === undefined) {
    ignoreFunctions = false;
  }
  if (node.parent === undefined) {
    return undefined;
  } else if (!ignoreFunctions && 
             (node.parent.hasProperty(Properties.SETTER) ||
             (node.parent.hasProperty(Properties.FUNCTION) && !node.parent.hasProperty(Properties.CONJUNCTION))))  {
    return undefined;
  } else if (node.parent.hasProperty(Properties.ATTRIBUTE)) {
    return node.parent;
  } else {
    return previouslyMatchedAttribute(node.parent,ignoreFunctions);
  }
}

// Inserts a node after the target, moving all of the
// target's children to the node
// Before: [Target] -> [Children]
// After:  [Target] -> [Node] -> [Children]
function insertAfterNode(node: Node, target: Node): void {
  node.parent = target;
  node.children = target.children;
  target.children.map((n) => n.parent = node);
  target.children = [node];
}

function insertBeforeNode(node: Node, target: Node): void {
  let parent = target.parent;
  if (parent !== undefined) {
    parent.addChild(node);
    parent.children.splice(parent.children.indexOf(target),1);
    node.addChild(target);
  }
}

// Find all leaf nodes stemming from a given node
function findLeafNodes(node: Node): Array<Node> {
  if(node.children.length === 0) {
    return [node];
  }
  else {
    let foundLeafs = node.children.map(findLeafNodes);
    let flatLeafs = flattenNestedArray(foundLeafs);
    return flatLeafs;
  }
} 

/*function moveNode(node: Node, target: Node): void {
  if (node.hasProperty(Properties.ROOT)) {
    return;
  }
  let parent = node.parent;
  parent.children.splice(parent.children.indexOf(node),1);
  parent.children = parent.children.concat(node.children);
  node.children.map((child) => child.parent = parent);
  node.children = [];
  node.parent = target;
  target.children.push(node);
}*/

// Finds a parent node with the specified property, 
// returns undefined if no node was found
function findParentWithProperty(node: Node, property: Properties): Node {
  if (node.parent === undefined) {
    return undefined;
  }
   else if (node.parent.hasProperty(property)) {
    return node.parent;
  } else {
    return findParentWithProperty(node.parent,property);
  } 
}

// Finds a parent node with the specified property, 
// returns undefined if no node was found
function findChildWithProperty(node: Node, property: Properties): Node {
  if (node.children.length === 0) {
    return undefined;
  }
  if (node.hasProperty(property)) {
    return node;
  } else {
    let childrenWithProperty = node.children.filter((child) => child.hasProperty(property));
    if (childrenWithProperty !== undefined) {
      return childrenWithProperty[0];
    } else {
      let results = node.children.map((child) => findChildWithProperty(child,property)).filter((result) => result !== undefined);
      if (results.length > 0) {
        return results[0];
      }
    }
  } 
}

// Finds a parent node with the specified POS, 
// returns undefined if no node was found
function findParentWithPOS(node: Node, majorPOS: MajorPartsOfSpeech): Node {
  if (getMajorPOS(node.token.POS) === MajorPartsOfSpeech.ROOT) {
    return undefined;
  }
  if (getMajorPOS(node.parent.token.POS) === majorPOS) {
    return node.parent;
  } else {
    return findParentWithPOS(node.parent,majorPOS);
  } 
}

/*
// Sets node to be a sibling of its parent
// Before: [Grandparent] -> [Parent] -> [Node] 
// After:  [Grandparent] -> [Parent]
//                       -> [Node]
function promoteNode(node: Node): void {
  if (node.parent.hasProperty(Properties.ROOT)) {
    return;
  }
  let newSibling = node.parent;
  let newParent = newSibling.parent;
  // Set parent
  node.parent = newParent;
  // Remove node from parent's children
  newSibling.children.splice(newSibling.children.indexOf(node),1);
  // Add node to new parent's children
  newParent.children.push(node);
}*/

// Makes the node's parent a child of the node.
// The node's grandparent is then the node's parent
// Before: [Grandparent] -> [Parent] -> [Node]
// After: [Grandparen] -> [Node] -> [Parent]
function makeParentChild(node: Node): void {
  let parent = node.parent;
  // Do not swap with root
  if (parent.hasProperty(Properties.ROOT)) {
    return;
  }
  // Set parents
  node.parent = parent.parent
  parent.parent = node;
  // Remove node as a child from parent
  parent.children.splice(parent.children.indexOf(node),1);
  // Set children
  node.children = node.children.concat(parent);
  node.parent.children.push(node);
  node.parent.children.splice(node.parent.children.indexOf(parent),1);
}


// Swaps a node with its parent. The node's parent
// is then the parent's parent, and its child is the parent.
// The parent gets the node's children
function swapWithParent(node: Node): void {
  let parent = node.parent;
  let pparent = parent.parent;
  if (parent.hasProperty(Properties.ROOT)) {
    return;
  }
  parent.parent = node;
  parent.children = node.children;
  pparent.children.splice(pparent.children.indexOf(parent),1);
  node.parent = pparent;
  node.children = [parent];
  pparent.children.push(node);
}

interface Context {
  entities: Array<Node>,
  collections: Array<Node>,
  attributes: Array<Node>,
  fxns: Array<Node>,
  groupings: Array<Node>,
  relationships: Array<Relationship>,
  found: Array<Node>,
  arguments: Array<Node>,
  maybeEntities: Array<Node>,
  maybeAttributes: Array<Node>,
  maybeCollections: Array<Node>,
  maybeFunctions: Array<Node>,
  maybeArguments: Array<Node>,
  internalFxns: Array<Node>,
  nodes: Array<Node>,
  stateFlags: {list: boolean, insert: boolean},
}



function newContext(): Context {
  return {
    entities: [],
    collections: [],
    attributes: [],
    fxns: [],
    groupings: [],
    relationships: [],
    found: [],
    arguments: [],
    maybeEntities: [],
    maybeAttributes: [],
    maybeCollections: [],
    maybeFunctions: [],
    maybeArguments: [],
    internalFxns: [],
    nodes: [],
    stateFlags: {list: false, insert: false},
  };
}

export enum FunctionTypes {
  FILTER,
  AGGREGATE,
  BOOLEAN,
  CALCULATE,
  INSERT,
  SELECT,
  GROUP,
  NEGATE,
}

interface BuiltInFunction {
  name: string,
  type: FunctionTypes,
  attribute?: string,
  fields: Array<FunctionField>,
  project: boolean,
  negated?: boolean,
  node?: Node,
  projectedAs?: string,
}

interface FunctionField {
  name: string,
  types: Array<Properties>,
}

function stringToFunction(word: string): BuiltInFunction {
  let all = [Properties.ENTITY, Properties.ATTRIBUTE, Properties.COLLECTION, Properties.FUNCTION, Properties.ROOT];
  let CFA = [Properties.COLLECTION, Properties.FUNCTION, Properties.ATTRIBUTE];
  let filterFields = [{name: "a", types: [Properties.ATTRIBUTE, Properties.QUANTITY]}, 
                      {name:"b", types: [Properties.ATTRIBUTE, Properties.QUANTITY]}
                     ];
  let calculateFields = [{name: "result", types: [Properties.OUTPUT]}, 
                         {name: "a", types: [Properties.ATTRIBUTE, Properties.QUANTITY]}, 
                         {name:"b", types: [Properties.ATTRIBUTE, Properties.QUANTITY]}
                        ];
  switch (word) {
    case "after":
    case ">":
      return {name: ">", type: FunctionTypes.FILTER, fields: filterFields, project: false};
    case "before":
    case "<":
      return {name: "<", type: FunctionTypes.FILTER, fields: filterFields, project: false};
    case ">=":
      return {name: ">=", type: FunctionTypes.FILTER, fields: filterFields, project: false};
    case "<=":
      return {name: "<=", type: FunctionTypes.FILTER, fields: filterFields, project: false};
    case "=":
      return {name: "=", type: FunctionTypes.FILTER, fields: filterFields, project: false};
    case "!=":
      return {name: "!=", type: FunctionTypes.FILTER, fields: filterFields, project: false};     
    case "taller":
      return {name: ">", type: FunctionTypes.FILTER, attribute: "height", fields: filterFields, project: false};
    case "shorter":
      return {name: "<", type: FunctionTypes.FILTER, attribute: "length", fields: filterFields, project: false};
    case "longer":
      return {name: ">", type: FunctionTypes.FILTER, attribute: "length", fields: filterFields, project: false};
    case "younger":
      return {name: "<", type: FunctionTypes.FILTER, attribute: "age", fields: filterFields, project: false};
    case "&":
    case "and":
      return {name: "and", type: FunctionTypes.BOOLEAN, fields: [], project: false};
    case "or":
      return {name: "or", type: FunctionTypes.BOOLEAN, fields: [], project: false};
    case "total":
    case "sum":
      return {name: "sum", type: FunctionTypes.AGGREGATE, fields: [{name: "sum", types: [Properties.OUTPUT]}, 
                                                                   {name: "value", types: [Properties.ATTRIBUTE]}], project: true, projectedAs: "sum"};
    case "count":
    case "number of":
    case "count the number of":
    case "count number of":
    case "how many":
      return {name: "count", type: FunctionTypes.AGGREGATE, fields: [{name: "count", types: [Properties.OUTPUT]},
                                                                     {name: "root", types: all}], project: true, projectedAs: "count"};

    case "average":
    case "avg":
    case "mean":
      return {name: "average", type: FunctionTypes.AGGREGATE, fields: [{name: "average", types: [Properties.OUTPUT]}, 
                                                                       {name: "value", types: [Properties.ATTRIBUTE]}], project: true, projectedAs: "average"};
    case "plus":
    case "add":
    case "+":
      return {name: "+", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true, projectedAs: "+"};
    case "subtract":
    case "minus":
    case "-":
      return {name: "-", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true, projectedAs: "-"};
    case "times":
    case "multiply":
    case "multiplied":
    case "multiplied by":
    case "*":
      return {name: "*", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true, projectedAs: "*"};
    case "divide":
    case "divided":
    case "divided by":
    case "/":
      return {name: "/", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true, projectedAs: "/"};
    case "^":
      return {name: "^", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true, projectedAs: "^"};
    case "is":
    case "is a":
    case "is an":
      return {name: "insert", type: FunctionTypes.INSERT, fields: [{name: "entity", types: [Properties.ENTITY]}, 
                                                                   {name: "attribute", types: [Properties.ATTRIBUTE]}, 
                                                                   {name: "root", types: all}], project: false};
    /*case "are":
      return {name: "insert", type: FunctionTypes.INSERT, fields: [{name: "collection", types: [Properties.COLLECTION]},
                                                                   {name: "collection", types: [Properties.COLLECTION]}], project: false};*/ 
    case "his":
    case "hers":
    case "their":
    case "its":
    case "'s":
    case "'":
      return {name: "select", type: FunctionTypes.SELECT, fields: [{name: "subject", types: [Properties.ENTITY, Properties.COLLECTION, Properties.ATTRIBUTE]}], project: false}; 
    case "by":
    case "grouped by":
    case "per":
      return {name: "group", type: FunctionTypes.GROUP, fields: [{name: "root", types: all}, 
                                                                 {name: "collection", types: [Properties.COLLECTION, Properties.ATTRIBUTE]}], project: false};
    case "except":
    case "without":
    case "not":
    case "aren't":
      return {name: "negate", type: FunctionTypes.NEGATE, fields: [{name: "negated", types: CFA}], project: false};
    default:
      return undefined;
  }  
}

function findFunction(node: Node, context: Context): boolean {
  log(`Searching for function: ${node.name}`);
  let fxn = stringToFunction(node.name); 
  if (fxn === undefined) {  
    log(` Not Found: ${node.name}`);
    return false;
  }
  
  // Insert function needs to follow a possessive function
  if (fxn.type === FunctionTypes.INSERT && !context.found.some((n) => n.hasProperty(Properties.POSSESSIVE))) {
    return false;
  }
  
  log(` Found: ${fxn.name}`);
  node.fxn = fxn;
  fxn.node = node;
  // Add arguments to the node
  let args = fxn.fields.map((field, i) => {
    let argToken = newToken(field.name);
    let argNode = newNode(argToken);
    argNode.properties.push(Properties.ARGUMENT);
    if (fxn.project && i === 0) {
      argNode.properties.push(Properties.OUTPUT);
      argNode.found = true;
      let outputToken = newToken("output"+context.fxns.length);
      let outputNode = newNode(outputToken);
      let outputAttribute = {
        id: outputNode.name,
        displayName: outputNode.name,
        variable: outputNode.name,
        node: outputNode,
        project: false,
      }
      outputNode.attribute = outputAttribute;
      outputNode.properties.push(Properties.OUTPUT);
      outputNode.found = true;
      argNode.addChild(outputNode);          
    } else {
      argNode.properties.push(Properties.INPUT);
    }
    argNode.properties = argNode.properties.concat(field.types);
    context.arguments.push(argNode);
    return argNode;
  });
  node.properties.push(Properties.FUNCTION);
  for (let arg of args) {
    node.addChild(arg);
  }
  node.found = true;
  node.type = NodeTypes.FUNCTION;
  if (node.fxn.type === FunctionTypes.AGGREGATE || 
      node.fxn.type === FunctionTypes.CALCULATE ||
      node.fxn.type === FunctionTypes.FILTER) {
    context.fxns.push(node);      
  }
  context.internalFxns.push(node);
  return true;
}

function formTree(node: Node, tree: Node, context: Context): {tree: Node, context: Context} {
  log("--------------------------------");
  log(node.toString());
  log(context);
  if (context.nodes.indexOf(node) === -1) {
    context.nodes.push(node);
  }
  // Don't do anything with subsumed nodes
  if (node.hasProperty(Properties.SUBSUMED)) {
    log("Skipping...");
    return {tree: tree, context: context};
  }
  
  // -------------------------------------
  // Step 1: Build n-grams
  // -------------------------------------
  log("ngrams:");
  
  // Flatten the tree
  let nextNode = tree;
  let nodes: Array<Node> = [];
  while(nextNode !== undefined) {
    nodes.push(nextNode);
    nextNode = nextNode.next();
  }
  
  // Build ngrams
  // Initialize the ngrams with 1-grams
  let ngrams: Array<Array<Node>> = nodes.map((node) => [node]);
  // Shift off the root node
  ngrams.shift();
  let n = 4;
  let m = ngrams.length;
  let offset = 0;
  for (let i = 0; i < n - 1; i++) {
    let newNgrams: Array<Array<Node>> = [];
    for (let j = offset; j < ngrams.length; j++) {
      let thisNgram = ngrams[j];
      let nextNgram = ngrams[j + 1];
      // Break at the end of the ngrams
      if (nextNgram === undefined) {
        break;
      }
      // From the new ngram
      let newNgram = thisNgram.concat([nextNgram[nextNgram.length-1]]);
      newNgrams.push(newNgram);
    }
    offset = ngrams.length;
    ngrams = ngrams.concat(newNgrams);
  }
  
  // Check each ngram for a display name
  let matchedNgrams: Array<Array<Node>> = [];
  for (let i = ngrams.length - 1; i >= 0; i--) {
    let ngram = ngrams[i];    
    let allFound = ngram.every((node) => node.found);
    if (allFound !== true) {
      let displayName = ngram.map((node)=>node.name).join(" ").replace(/ '/g,'\'');
      log(displayName)
      let foundName = eve.findOne("index name",{ name: displayName });
      // If the display name is in the system, mark all the nodes as found 
      if (foundName !== undefined) {
        ngram.map((node) => node.found = true);
        matchedNgrams.push(ngram);
      } else {
        let foundAttribute = eve.findOne("entity eavs", { attribute: displayName });
        if (foundAttribute !== undefined) {
          ngram.map((node) => node.found = true);
          matchedNgrams.push(ngram);  
        } else {
          let fxn = stringToFunction(displayName);
          if (fxn !== undefined) {
            ngram.map((node) => node.found = true);
            // "engineers are employees" asserts that every engineer is also an employee
            // "engineers that are employees" is asking for the intersection of engineers and employees
            // "that" is a determiner, which cnages the meaning of the sentence, so we prevent 
            // an insert using this heuristic 
            if (fxn.type === FunctionTypes.INSERT && 
                (ngram[0].prev().token.POS === MinorPartsOfSpeech.DT || 
                 getMajorPOS(ngram[0].prev().token.POS) === MajorPartsOfSpeech.WHWORD)) {
              return {tree: tree, context: context};
            } else {
              matchedNgrams.push(ngram);
            }
          }
        }
      }
    }
  }
  
  // Turn matched ngrams into compound nodes  
  for (let ngram of matchedNgrams) {
    // Don't do anything for 1-grams
    if (ngram.length === 1) {
      ngram[0].found = false;
      continue;
    }
    let displayName = ngram.map((node)=>node.name).join(" ").replace(/ '/g,'\'');
    log (`Creating compound node: ${displayName}`);
    let lastGram = ngram[ngram.length - 1];
    let compoundToken = newToken(displayName);
    compoundToken.prev = ngram[0].token.prev;
    let compoundNode = newNode(compoundToken);
    compoundNode.constituents = ngram;
    compoundNode.constituents.map((node) => node.properties.push(Properties.SUBSUMED));
    compoundNode.ix = lastGram.ix;
    // Inherit properties from the nodes
    compoundNode.properties = lastGram.properties;    
    compoundNode.properties.push(Properties.COMPOUND);
    compoundNode.properties.splice(compoundNode.properties.indexOf(Properties.SUBSUMED),1); // Don't inherit subsumed property
    // The compound node results from the new node,
    // so the compound node replaces it
    node = compoundNode;
  }
  log('-------');

  // -------------------------------------
  // Step 2: Identify the node
  // -------------------------------------
  
  // If the node is a quantity, just build an attribute
  if (node.hasProperty(Properties.QUANTITY)) {
    let quantityAttribute: Attribute = {
      id: node.name,
      displayName: node.name,
      variable: node.name,
      node: node,
      project: false,
      handled: true,
    }
    node.quantity = parseFloat(node.name);
    node.properties.push(Properties.ATTRIBUTE);
    node.type = NodeTypes.NUMBER;
    node.attribute = quantityAttribute;
    node.found = true;
  }
  
  // Find a collection, entity, attribute, or function
  if (!node.found) {
    findCollection(node, context);
    if (!node.found) {
      findAttribute(node, context); 
      if (!node.found) {
        findEntity(node, context);
        if (!node.found) {
          findFunction(node, context);  
          if (!node.found) {
            log(node.name + " was not found anywhere!");
          }
        }
      }
    }
  }
  
  // If the node wasn't found at all, don't try to place it anywhere
  if (!node.found && context.stateFlags.insert === false) {
    if (getMajorPOS(node.token.POS) === MajorPartsOfSpeech.NOUN) {
      if (node.hasProperty(Properties.PROPER)) {
        context.maybeEntities.push(node);
      } else if (node.hasProperty(Properties.PLURAL)) {
        context.maybeCollections.push(node);
      } else {
        context.maybeAttributes.push(node);
      }
    }
    return {tree: tree, context: context};
  } else if (!node.found && context.stateFlags.insert === true) {
    let root = context.arguments.filter((a) => a.hasProperty(Properties.ROOT)).pop();
    if (root !== undefined) {
      node.found = true;
      addNodeToFunction(node, root.parent, context);
    }
    context.maybeAttributes.push(node);
    return {tree: tree, context: context};
  } else if (node.found && !node.foundReps) {
    findAlternativeRepresentations(node);
  }
  
  // -------------------------------------
  // Step 3: Insert the node into the tree
  // -------------------------------------
  
  log("Matching: " + node.name);
    
  // If the node is compound, replace the last subsumed node with it
  if (node.hasProperty(Properties.COMPOUND)) {
    let subsumedNode = node.constituents[node.constituents.length - 2];
    if (subsumedNode.parent !== undefined) {
      log(`Replacing "${subsumedNode.name}" with "${node.name}"`)
      insertBeforeNode(node,subsumedNode);
      removeBranch(subsumedNode);
      let children = subsumedNode.children;
      // Relinquish children
      for (let child of children) {
        if (child.hasProperty(Properties.ARGUMENT)) {
          for (let grandChild of child.children) {
            removeBranch(grandChild);
            formTree(grandChild, tree, context);
          }
        } else {
          removeBranch(child);
          formTree(child, tree, context);
        }
      }
      // filter context
      context.internalFxns = context.internalFxns.filter((f) => !f.hasProperty(Properties.SUBSUMED));
      context.arguments = context.arguments.filter((a) => !a.parent.hasProperty(Properties.SUBSUMED));
      return {tree: tree, context: context};  
    }
  }
  // Handle functions
  if (node.hasProperty(Properties.FUNCTION)) {
    // Find an argument to attach the node to
    let functionArg = context.arguments.filter((n) => n.hasProperty(Properties.FUNCTION) && n.parent !== node && !n.found);
    if (functionArg.length > 0) {
      let arg = functionArg.pop();
      addNodeToFunction(node, arg.parent, context);
    } else {
      tree.addChild(node);  
    }
    
    // If the node is a grouping node, attach the old root to the new one
    if (node.fxn.type === FunctionTypes.GROUP) {
      let newRoot = node.children[0];
      for (let child of tree.children) {
        if (child === node) {
          continue;
        } else {
          reroot(child, newRoot);
        }
        newRoot.found = true;
      }
    // If the node is an insert, attach unidentified words  
    } else if (node.fxn.type === FunctionTypes.INSERT) {
      // Find an entity
      let entity = context.found.filter((n) => n.hasProperty(Properties.ENTITY) && n.ix < node.ix).pop();
      if (entity !== undefined) {
        removeNode(entity);
        addNodeToFunction(entity, node, context);  
        // Find an attribute
        let attribute = context.found.filter((n) => n.hasProperty(Properties.ATTRIBUTE) && n.ix > entity.ix).pop();
        if (attribute !== undefined) {
          removeNode(attribute);
          addNodeToFunction(attribute, node, context);
        } else {
          let attributeNodes = context.nodes.filter((ma) => ma.ix > entity.ix + 1);
          attributeNodes.pop();
          if (attributeNodes.length > 0) {
            attributeNodes.map(removeNode);
            let nName = attributeNodes.map((ma) => ma.name).join(" ");
            let nToken = newToken(nName);
            nToken.ix = attributeNodes[0].ix;
            let nNode = newNode(nToken);
            nNode.type = NodeTypes.STRING;  
            nNode.found = true;
            nNode.properties.push(Properties.ATTRIBUTE);
            addNodeToFunction(nNode, node, context);
          }
        }
      }  
    // If the node is a filter, attach filter nodes  
    } else if (node.fxn.type === FunctionTypes.FILTER) {
      // If an attribute is specified, create an attribute node for each one
      if (node.fxn.attribute !== undefined) {
        // LHS
        let nToken = newToken(node.fxn.attribute);
        let nNode = newNode(nToken);
        formTree(nNode, tree, context);
        // RHS
        nToken = newToken(node.fxn.attribute);
        nNode = newNode(nToken);
        findAttribute(nNode, context);
        addNodeToFunction(nNode, node, context);
      // No attribute is specified, try to attach existing attributes
      } else {
       let orphans = context.found.filter((n) => n.hasProperty(Properties.ATTRIBUTE));
       for (let orphan of orphans) {
          removeNode(orphan);
          formTree(orphan, tree, context);
          // Break when all args are filled
          if (node.children.every((n) => n.found)) {
            break;
          }
        } 
      }
    // If the node is a negate, don't do a back search
    } else if (node.fxn.type === FunctionTypes.NEGATE) {
      // This space is left intentionally blank
    } else if (node.fxn.type === FunctionTypes.CALCULATE) {
      let AQFs = context.nodes.filter((n) => n.hasProperty(Properties.ATTRIBUTE) || 
                                             n.hasProperty(Properties.QUANTITY) || 
                                             n.hasProperty(Properties.FUNCTION));
      for (let aqf of AQFs ) {
        if (aqf.parent !== undefined && aqf.parent.hasProperty(Properties.ARGUMENT)) {
          continue;
        }
        if (aqf.hasProperty(Properties.FUNCTION)) {
          if (aqf.fxn.type === FunctionTypes.AGGREGATE) {
            removeBranch(aqf);   
          } else {
            continue;
          }
        } else {
          removeNode(aqf)  
        }
        formTree(aqf, tree, context);
        if (node.children.every((n) => n.found)) {
          break;
        }
      }
    // Otherwise, just attach arguments that are applicable
    } else {  
      if (node.fxn.fields.length > 0) {
        for (let i = context.found.length -1; i >= 0; i--) {
          let foundNode = context.found[i]; 
          removeNode(foundNode);
          formTree(foundNode, tree, context);
          // Break when all args are filled
          if (node.children.every((n) => n.found)) {
            break;
          }
        } 
      }
    }
  // Handle everything else
  } else {
    // Find a relationship if we have to
    let relationship: Relationship = {type: RelationshipTypes.NONE};
    if (node.relationships.length === 0) {
      //let orphans = tree.children.filter((child) => child.relationships.length === 0 && child.children.length === 0);  
      for (let i = context.found.length -1; i >= 0; i--) {
        let foundNode = context.found[i]; 
        if (foundNode === node) {
          continue;
        }
        if (node.relationships.length === 0) {
          removeNode(node);
        }
        relationship = findRelationship(node, foundNode, context);
        if (relationship.type !== RelationshipTypes.NONE) {
          break;
        } else if (relationship.type === RelationshipTypes.NONE) {
          if (foundNode.hasProperty(Properties.POSSESSIVE) && !node.found && !node.hasProperty(Properties.QUANTITY)) {
            context.maybeAttributes.push(node);
          }
        }
      }
    }
    
    // Place the node onto a function if one is open
    let openFunctions = context.internalFxns.filter((fxn) => !fxn.children.every((c) => c.found));
    for (let fxnNode of openFunctions) {
      let added = addNodeToFunction(node, fxnNode, context);
      if (added) {
        relationship.type = RelationshipTypes.DIRECT;
        break;
      }
    }
    
    // If no relationships were found, stick the node onto the root
    if (node.parent === undefined && node.relationships.length === 0) {
      tree.addChild(node);
    // If there is a relationship, but the node has no parent, just put it on the root
    } else if (node.parent === undefined) {
      let relatedNodes = node.relationships.map((r) => r.nodes);
      let flatRelatedNodes = flattenNestedArray(relatedNodes);
      let relatedAttribute = flatRelatedNodes.filter((n) => n.hasProperty(Properties.ATTRIBUTE)).shift();
      if (relatedAttribute !== undefined) {
        let root = findParentWithProperty(relatedAttribute, Properties.ROOT);
        if (root !== undefined) {
          root.addChild(node);
        } else {
          tree.addChild(node);
        }
      } else {
        tree.addChild(node);
      }
    }
    // Finally add any nodes implicit in the relationship    
    if (relationship.implicitNodes !== undefined && relationship.implicitNodes.length > 0) {
      for (let implNode of relationship.implicitNodes) {
        formTree(implNode, tree, context);
      }
    }
  }
  
  // Switch state
  if (node.fxn && node.fxn.type === FunctionTypes.INSERT) {
    context.stateFlags.insert = true;
  }
  
  log("Tree:");
  log(tree.toString());
  return {tree: tree, context: context};
}

// Find all the representations of a thing
function findAlternativeRepresentations(node: Node): void {
  
  let attr = findEveAttribute(node.name);
  let coll = findEveCollection(node.name);
  let ent = findEveEntity(node.name);
  let fxn = stringToFunction(node.name);
  
  node.representations = {
    collection: coll,
    entity: ent,
    attribute: attr,
    fxn: fxn,
  }
  node.foundReps = true;
}

// Swap the representation of the node with another one
// Clears all attributes related to the old rep, and adds a new one
function changeRepresentation(node: Node, rep: Properties, context: Context): boolean {
  // Clear the node
  node.found = false;
  if (node.collection !== undefined) {
    node.collection = undefined;  
    node.properties.splice(node.properties.indexOf(Properties.COLLECTION),1);
  } else if (node.entity !== undefined) {
    node.entity = undefined;
    node.properties.splice(node.properties.indexOf(Properties.ENTITY),1);
  } else if (node.attribute !== undefined) {
    node.attribute = undefined;
    node.properties.splice(node.properties.indexOf(Properties.ATTRIBUTE),1);
  } else if (node.fxn !== undefined) {
    node.fxn = undefined;
    node.properties.splice(node.properties.indexOf(Properties.FUNCTION),1);
  }
  // Switch the representation
  if (rep === Properties.COLLECTION) {
    if (node.representations.collection) {
      findCollection(node, context);
      return true;
    }
  } else if (rep === Properties.ENTITY) {
    if (node.representations.entity) {
      findEntity(node, context);
      return true;
    }
  } else if (rep === Properties.ATTRIBUTE) {
    if (node.representations.attribute) {
      findAttribute(node, context);
      return true;
    }
  } else if (rep === Properties.FUNCTION) {
    if (node.representations.fxn) {
      findFunction(node, context);
      return true;
    }
  }
  return false;
}

// Adds a node to an argument. If adding the node completes a select,
// a new node will be returned
function addNodeToFunction(node: Node, fxnNode: Node, context: Context): boolean {
  log(`Matching "${node.name}" with function "${fxnNode.name}"`);
  // Find the correct arg
  let arg: Node;
  if (node.hasProperty(Properties.ENTITY)) {
    arg = fxnNode.children.filter((c) => c.hasProperty(Properties.ENTITY) && !c.found).shift();
  } else if (node.hasProperty(Properties.COLLECTION)) {
    arg = fxnNode.children.filter((c) => c.hasProperty(Properties.COLLECTION) && !c.found).shift();
  } else if (node.hasProperty(Properties.ATTRIBUTE)) {
    arg = fxnNode.children.filter((c) => c.hasProperty(Properties.ATTRIBUTE) && !c.found).shift();
  } else if (node.hasProperty(Properties.FUNCTION)) {
    arg = fxnNode.children.filter((c) => c.hasProperty(Properties.FUNCTION) && !c.found).shift();
  } else {
    arg = fxnNode.children.filter((c) => c.hasProperty(Properties.ROOT)).shift();
  }

  // Add the node to the arg
  if (arg !== undefined) {
    if (fxnNode.fxn.type === FunctionTypes.GROUP && arg.name === "collection") {
      context.groupings.push(node);
      arg.addChild(node);
    } else if (fxnNode.fxn.type === FunctionTypes.SELECT) {
      let root = findParentWithProperty(fxnNode, Properties.ROOT);
      removeBranch(fxnNode);
      context.arguments.splice(context.arguments.indexOf(node.children[0]),1);
      context.internalFxns.splice(context.internalFxns.indexOf(fxnNode),1);
      node.properties.push(Properties.POSSESSIVE);
      root.addChild(node);
      return true;
    } else {
      arg.addChild(node);
    }
    arg.found = true;
    return true;
  } else {
    return false;
  }
}

// EAV Functions

interface Entity {
  id: string,
  displayName: string,
  node?: Node,
  refs?: Array<Node>,
  variable: string,
  project: boolean,
  handled?: boolean,
  entityAttr: boolean,
  entityVar: boolean,
  valueVar: boolean,
  value?: string,
  projectedAs?: string,
}

interface Collection {
  id: string,
  displayName: string,
  node?: Node,
  refs?: Array<Node>,
  variable: string,
  project: boolean,
  handled?: boolean,
  projectedAs?: string,
}

function cloneCollection(collection: Collection): Collection {
  let clone: Collection = {
    id: collection.id,
    displayName: collection.displayName,
    node: collection.node,
    variable: collection.variable,
    project: collection.project,
  }
  return clone;
}

interface Attribute {
  id: string,
  displayName: string,
  node?: Node,
  refs?: Array<Node>,
  variable: string,
  project: boolean,
  handled?: boolean,
  projectedAs?: string,
  attributeVar?: boolean,
}

// Returns the entity with the given display name.
// If the entity is not found, returns undefined
// Two error modes here: 
// 1) the name is not found in "display name"
// 2) the name is found in "display name" but not found in "entity"
// can 2) ever happen?
// Returns the collection with the given display name.
function findEveEntity(search: string): Entity {
  log("Searching for entity: " + search);
  let foundEntity;
  let name: string;
  // Try to find by display name first
  let display = eve.findOne("index name",{ name: search });
  if (display !== undefined) {
    foundEntity = eve.findOne("entity", { entity: display.id });
    name = search;
  // If we didn't find it that way, try again by ID
  } else {
    foundEntity = eve.findOne("entity", { entity: search });
  }
  // Build the entity
  if (foundEntity !== undefined) {
    if (name === undefined) {
      display = eve.findOne("display name",{ id: search });
      name = display.name;  
    }
    let entity: Entity = {
      id: foundEntity.entity,
      displayName: name,
      variable: name.replace(/ /g,''),
      project: true,
      entityAttr: false,
      entityVar: false,
      valueVar: false,
    }
    log(" Found: " + entity.id);
    return entity;
  } else {
    log(" Not found: " + search);
    return undefined;  
  }
}
// Returns the collection with the given display name.
function findEveCollection(search: string): Collection {
  log("Searching for collection: " + search);
  let foundCollection;
  let name: string;
  // Try to find by display name first
  let display = eve.findOne("index name",{ name: search });
  if (display !== undefined) {
    foundCollection = eve.findOne("collection", { collection: display.id });
    name = search;
  // If we didn't find it that way, try again by ID
  } else {
    foundCollection = eve.findOne("collection", { collection: search });
  }
  // Build the collection
  if (foundCollection !== undefined) {
    if (name === undefined) {
      display = eve.findOne("display name",{ id: search });
      name = display.name;  
    }
    let collection: Collection = {
      id: foundCollection.collection,
      displayName: name,
      variable: name.replace(/ /g,''),
      project: true,
    }
    log(" Found: " + collection.id);
    return collection;
  } else {
    log(" Not found: " + search);
    return undefined;  
  }
}

// Returns the attribute with the given display name attached to the given entity
// If the entity does not have that attribute, or the entity does not exist, returns undefined
function findEveAttribute(name: string): Attribute {
  log("Searching for attribute: " + name);
  let foundAttribute = eve.findOne("entity eavs", { attribute: name });
  if (foundAttribute !== undefined) {
    let attribute: Attribute = {
      id: foundAttribute.attribute,
      displayName: name,
      variable: name.replace(/ /g,''),
      project: true,
    }
    log(" Found: " + name);
    log(attribute);
    return attribute;
  }
  log(" Not found: " + name);
  return undefined;
}

enum RelationshipTypes {
  NONE,
  DIRECT,
  ONEHOP,
  TWOHOP,
  INTERSECTION,
}

interface Relationship {
  type: RelationshipTypes,
  nodes?: Array<Node>,
  implicitNodes?: Array<Node>,
}

function findRelationship(nodeA: Node, nodeB: Node, context: Context): Relationship {
  let relationship = {type: RelationshipTypes.NONE};
  if ((nodeA === nodeB) || 
      (context.stateFlags.insert) ||
      (nodeA.hasProperty(Properties.QUANTITY) && nodeB.hasProperty(Properties.QUANTITY))) {
    return relationship;
  }
  log(`Finding relationship between "${nodeA.name}" and "${nodeB.name}"`);
    
  // Sort the nodes in order
  // 1) Collection 
  // 2) Entity 
  // 3) Attribute
  // 4) Function
  // 5) Quantity
  // 6) String
  nodeA.properties.sort((a, b) => a - b);
  nodeB.properties.sort((a, b) => a - b);
  let nodes = [nodeA, nodeB].sort((a, b) => a.properties[0] - b.properties[0]);
  nodeA = nodes[0]
  nodeB = nodes[1];
  
  // Find the proper relationship
  if (nodeA.hasProperty(Properties.ENTITY) && nodeB.hasProperty(Properties.ATTRIBUTE)) {
    relationship = findEntToAttrRelationship(nodeA, nodeB, context);
  } else if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.ATTRIBUTE)) {
    relationship = findCollToAttrRelationship(nodeA, nodeB, context);
  } else if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.COLLECTION)) {
    relationship = findCollToCollRelationship(nodeA, nodeB, context);
  } else if (nodeA.hasProperty(Properties.ATTRIBUTE) && nodeB.hasProperty(Properties.ATTRIBUTE)) {
    relationship = findAttrToAttrRelationship(nodeA, nodeB, context);
  } else if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.ENTITY)) {
    relationship = findCollToEntRelationship(nodeA, nodeB, context);
  } 
  
  // Add relationships to the nodes and context
  if (relationship.type !== RelationshipTypes.NONE) {
    nodeA.relationships.push(relationship);
    nodeB.relationships.push(relationship);
    context.relationships.push(relationship);
  // If no relationship was found, change the representation of the node
  } else {
    nodes = [nodeA, nodeB].sort((a,b) => a.ix - b.ix);
    nodeA = nodes[0];
    nodeB = nodes[1];
    let repChanged = false;
    // If one node is possessive, it suggests the other should be represented as an attribute of the first
    if (nodeA.hasProperty(Properties.POSSESSIVE) && !nodeB.hasProperty(Properties.ATTRIBUTE) && nodeB.representations.attribute !== undefined) {
      repChanged = changeRepresentation(nodeB, Properties.ATTRIBUTE, context); 
    } else if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.COLLECTION) && nodeB.representations.attribute !== undefined) {
      repChanged = changeRepresentation(nodeB, Properties.ATTRIBUTE, context);
    }
    if (repChanged) {
      relationship = findRelationship(nodeA, nodeB, context);
    }
  }
  return relationship;
}

// e.g. Corey's wife's age
function findAttrToAttrRelationship(attrA: Node, attrB: Node, context: Context): Relationship {
  log(`Finding Attr -> Attr relationship between "${attrA.name}" and "${attrB.name}"...`);
  
  console.log(attrA)
  console.log(attrB)
  
  if (attrA.hasProperty(Properties.QUANTITY)) {
    let temp = attrA;
    attrA = attrB; 
    attrB = temp;
  }
  
  // e.g. employees whose salary is 10
  if (attrA.relationships.length > 0 && attrB.hasProperty(Properties.QUANTITY) && !attrA.parent.hasProperty(Properties.ARGUMENT)) {
    attrA.attribute.variable = `${attrB.quantity}`;
    attrA.attribute.attributeVar = false;
    attrA.attribute.project = false;
    return {type: RelationshipTypes.DIRECT, nodes: [attrA, attrB]};   
  } else {
    return {type: RelationshipTypes.NONE};  
  }
  
  // Check whether one of the attributes is an entity attribute
  let direct = false;
  if (attrA.hasProperty(Properties.POSSESSIVE)) {
    direct = true;    
  } else if (attrB.hasProperty(Properties.POSSESSIVE)) {
    let tNode = attrA;
    attrA = attrB;
    attrB = tNode;
    direct = true;
  }
  
  if (direct) {
    log("  Found a direct relationship");
    // Create an entity attribute
    let entityAttr = attrA.attribute;
    let ent: Entity = {
      id: entityAttr.variable,
      displayName: entityAttr.variable,
      variable: entityAttr.variable,
      project: false,
      entityAttr: true,
      entityVar: false,
      valueVar: false,
    }
    let nToken = newToken(entityAttr.variable);
    let nNode = newNode(nToken);
    nNode.entity = ent;
    ent.node = nNode;
    attrB.attribute.variable = `${attrA.attribute.variable}|${attrB.attribute.id}`;
    attrB.attribute.refs = [nNode];
    return {type: RelationshipTypes.DIRECT, nodes: [attrA, attrB]}; 
  }
  return {type: RelationshipTypes.NONE};  
}


// e.g. "meetings john was in"
function findCollToEntRelationship(coll: Node, ent: Node, context: Context): Relationship {
  log(`Finding Coll -> Ent relationship between "${coll.name}" and "${ent.name}"...`);
  /*if (coll === "collections") {
    if (eve.findOne("collection entities", { entity: nodeB.entity.id })) {
      return { type: RelationshipTypes.DIRECT };
    }
  }
  if (eve.findOne("collection entities", { collection: coll.collection.id, entity: ent.entity.id })) {
    log("  Found Direct relationship")
    return { type: RelationshipTypes.DIRECT };
  }*/
  let eveRelationship = eve.query(``)
    .select("collection entities", { collection: coll.collection.id }, "collection")
    .select("directionless links", { entity: ["collection", "entity"], link: ent.entity.id }, "links")
    .exec();
  if (eveRelationship.unprojected.length) {
    let entities = extractFromUnprojected(eveRelationship.unprojected, 1, 2, "link");
    let collections = findCommonCollections(entities);
    let collLinkID;
    if (collections.length > 0) {
      log("  Found Direct Relationship");
      let entity = ent.entity;
      entity.entityVar = true;
      entity.project = false;
      entity.variable = coll.collection.variable;
      let relationship = {type: RelationshipTypes.DIRECT, nodes: [coll, ent]};
      return relationship;
    }
  }
  /*
  // e.g. events with chris granger (events -> meetings -> chris granger)
  let relationships2 = eve.query(``)
    .select("collection entities", { collection: coll }, "collection")
    .select("directionless links", { entity: ["collection", "entity"] }, "links")
    .select("directionless links", { entity: ["links", "link"], link: ent }, "links2")
    .exec();
  if (relationships2.unprojected.length) {
    let entities = extractFromUnprojected(relationships2.unprojected, 1, 3);
    return { type: RelationshipTypes.TWOHOP };
  }*/
  log("  No relationship found");
  return { type: RelationshipTypes.NONE };
}

function findEntToAttrRelationship(ent: Node, attr: Node, context: Context): Relationship {
  log(`Finding Ent -> Attr relationship between "${ent.name}" and "${attr.name}"...`);  
  
  // If the node already has a relationship, then treat the entity as filtering the node
  if (attr.relationships.length > 0 && !attr.parent.hasProperty(Properties.ARGUMENT)) {
    attr.attribute.variable = ent.entity.id;
    attr.attribute.attributeVar = false;
    attr.attribute.project = false;
    ent.entity.project = false;
    ent.entity.handled = true;
    return {type: RelationshipTypes.DIRECT, nodes: [ent, attr]};
  } else if (attr.relationships.length > 0) {
    return {type: RelationshipTypes.NONE};
  }
  
  // Check for a direct relationship
  // e.g. "Josh's age"
  let eveRelationship = eve.findOne("entity eavs", { entity: ent.entity.id, attribute: attr.attribute.id });
  if (eveRelationship) {
    log("  Found a direct relationship.");
    let attribute = attr.attribute;
    let varName = `${ent.name}|${attr.name}`.replace(/ /g,'');
    attribute.variable = varName;
    attribute.refs = [ent];
    attribute.project = true;
    ent.entity.handled = true;
    return {type: RelationshipTypes.DIRECT, nodes: [ent, attr], implicitNodes: []};
  }
  // Check for a one-hop relationship
  // e.g. "Salaries in engineering"
  eveRelationship = eve.query(``)
    .select("directionless links", { entity: ent.entity.id }, "links")
    .select("entity eavs", { entity: ["links", "link"], attribute: attr.attribute.id }, "eav")
    .exec();
  if (eveRelationship.unprojected.length) {
    
    log(eveRelationship);
    // Fill in the attribute
    let entities = extractFromUnprojected(eveRelationship.unprojected, 0, 2, "link");
    let collections = findCommonCollections(entities);

    let collLinkID;
    if (collections.length > 0) {
      log("  Found One-Hop Relationship");
      
      // @HACK Choose the correct collection in a smart way. 
      // Largest collection other than entity or testdata?
      collLinkID = collections[0];  
    
      let foundCollection = findEveCollection(collLinkID);
      let linkToken = newToken(foundCollection.displayName);
      let linkCollection = newNode(linkToken);
      findCollection(linkCollection, context);
      let attribute = attr.attribute;
      let varName = `${linkCollection.name}|${attr.name}`.replace(/ /g,'');
      attribute.variable = varName;
      attribute.refs = [linkCollection];
      
      // Find the one-hop link
      let getAttr = eve.query(``)
                      .select("directionless links", { entity: ent.entity.id }, "links")
                      .select("entity eavs", { entity: ["links", "link"], value: ent.entity.id }, "eav") 
                      .exec();
      let attributes = extractFromUnprojected(getAttr.unprojected,1,2,"attribute");
      attributes = attributes.filter(onlyUnique);
      let attrLinkID;
      let nNode;
      let implicitNodes = [];
      if (attributes.length > 0) {
        attrLinkID = attributes[0];
        // Build a link attribute node
        let newName = attrLinkID;
        let nToken = newToken(newName);
        nNode = newNode(nToken);
        let nAttribute: Attribute = {
          id: attrLinkID,
          refs: [linkCollection],
          node: nNode,
          displayName: attrLinkID,
          variable: `"${ent.entity.id}"`,
          project: false,
        }
        nNode.attribute = nAttribute;
        nNode.properties.push(Properties.ATTRIBUTE);
        nNode.found = true;
        implicitNodes.push(nNode);
      }
      // Project what we need to
      attribute.project = true;
      ent.entity.project = false;
      ent.entity.handled = true;
      let relationship = {type: RelationshipTypes.ONEHOP, nodes: [ent, attr], implicitNodes: implicitNodes};
      if (nNode !== undefined) {
        nNode.relationships.push(relationship);  
      }
      return relationship
    }
  }
  /*
  let relationships2 = eve.query(``)
    .select("directionless links", { entity: entity.id }, "links")
    .select("directionless links", { entity: ["links", "link"] }, "links2")
    .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
    .exec();
  if (relationships2.unprojected.length) {
    let entities = extractFromUnprojected(relationships2.unprojected, 0, 3);
    let entities2 = extractFromUnprojected(relationships2.unprojected, 1, 3);
    //return { distance: 2, type: RelationshipTypes.ENTITY_ATTRIBUTE, nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
  }*/
  log("  No relationship found.");
  return { type: RelationshipTypes.NONE };
}

export function findCollToCollRelationship(collA: Node, collB: Node, context: Context): Relationship {  
  log(`Finding Coll -> Coll relationship between "${collA.collection.displayName}" and "${collB.collection.displayName}"...`);
  // are there things in both sets?
  let intersection = eve.query(`${collA.collection.displayName}->${collB.collection.displayName}`)
    .select("collection entities", { collection: collA.collection.id }, "collA")
    .select("collection entities", { collection: collB.collection.id, entity: ["collA", "entity"] }, "collB")
    .exec();
  // is there a relationship between things in both sets
  let eveRelationship = eve.query(`relationships between ${collA.collection.displayName} and ${collB.collection.displayName}`)
    .select("collection entities", { collection: collA.collection.id }, "collA")
    .select("directionless links", { entity: ["collA", "entity"] }, "links")
    .select("collection entities", { collection: collB.collection.id, entity: ["links", "link"] }, "collB")
    .group([["links", "link"]])
    .aggregate("count", {}, "count")
    .project({ type: ["links", "link"], count: ["count", "count"] })
    .exec();
  let maxRel = { type: "", count: 0 };
  for (let result of eveRelationship.results) {
    if (result.count > maxRel.count) maxRel = result;
  }

  // we divide by two because unprojected results pack rows next to eachother
  // and we have two selects.
  let intersectionSize = intersection.unprojected.length / 2;
  if (maxRel.count > intersectionSize) {
    /*
    console.log(eveRelationship)
    let entities = extractFromUnprojected(eveRelationship.unprojected,1,2,"link").filter((e) => e !== undefined);
    let collections = findCommonCollections(entities);
    console.log(entities);
    console.log(collections)
    console.log(findEveCollection(collections[0]));*/
    log(" Direct relationship found");
    let nName = `${collA.name}|${collB.name}`;
    let nToken = newToken(nName);
    let nNode = newNode(nToken);
    // Create a link eav
    let entity: Entity = {
      id: nName,
      displayName: nName,
      variable: collB.collection.variable,
      value: collA.collection.variable,
      project: false,
      entityAttr: false,
      entityVar: true,
      valueVar: true,
      node: nNode,
      handled: false,
    }
    nNode.properties.push(Properties.ENTITY);
    nNode.entity = entity;
    nNode.found = true;
    collB.addChild(nNode);
    let relationship = {type: RelationshipTypes.DIRECT, nodes: [collA, collB]};
    nNode.relationships.push(relationship);    
    return relationship;
  } else if (intersectionSize > 0) {
    log(" Found Intersection relationship.");
    collA.collection.variable = collB.collection.variable;
    collB.collection.project = true;
    collA.collection.project = false;
    return {type: RelationshipTypes.INTERSECTION, nodes: [collA, collB]};
  } else if (maxRel.count === 0 && intersectionSize === 0) {
    log("  No relationship found2");
    return {type: RelationshipTypes.NONE};
  } else {
    // @TODO
    log("  No relationship found3");
    return {type: RelationshipTypes.NONE};
  }
}

function findCollToAttrRelationship(coll: Node, attr: Node, context: Context): Relationship {
  // Finds a direct relationship between collection and attribute
  // e.g. "pets' lengths"" => pet -> length
  log(`Finding Coll -> Attr relationship between "${coll.name}" and "${attr.name}"...`);
  let eveRelationship = eve.query(``)
    .select("collection entities", { collection: coll.collection.id }, "collection")
    .select("entity eavs", { entity: ["collection", "entity"], attribute: attr.attribute.id }, "eav")
    .exec();
  if (eveRelationship.unprojected.length > 0) {    
    log("  Found Direct Relationship");
    // Build an attribute node
    let attribute = attr.attribute;
    let varName = `${coll.name}|${attr.name}`.replace(/ /g,'');
    attribute.variable = varName;
    attribute.refs = [coll];
    attribute.project = true;
    return {type: RelationshipTypes.DIRECT, nodes: [coll, attr], implicitNodes: []};
  }
  // Finds a one hop relationship
  // e.g. "department salaries" => department -> employee -> salary
  eveRelationship = eve.query(``)
    .select("collection entities", { collection: coll.collection.id }, "collection")
    .select("directionless links", { entity: ["collection", "entity"] }, "links")
    .select("entity eavs", { entity: ["links", "link"], attribute: attr.attribute.id }, "eav")
    .exec();
  if (eveRelationship.unprojected.length > 0) {
    log("  Found One-Hop Relationship");
    log(eveRelationship)
    // Find the one-hop link
    let entities = extractFromUnprojected(eveRelationship.unprojected, 1, 3, "link");
    let collections = findCommonCollections(entities)
    let linkID;
    if (collections.length > 0) {
      // @HACK Choose the correct collection in a smart way. 
      // Largest collection other than entity or testdata?
      linkID = collections[0];  
    }    
    // Fill in the attribute
    let foundCollection = findEveCollection(linkID);
    let linkToken = newToken(foundCollection.displayName);
    let linkCollection = newNode(linkToken);
    findCollection(linkCollection, context);
    let attribute = attr.attribute;
    let varName = `${linkCollection.name}|${attr.name}`.replace(/ /g,'');
    attribute.variable = varName;
    attribute.refs = [linkCollection];
    attribute.project = true;
    // Build a link attribute node
    let newName = coll.collection.variable;
    let nToken = newToken(newName);
    let nNode = newNode(nToken);
    let nAttribute: Attribute = {
      id: coll.collection.displayName,
      refs: [linkCollection],
      node: nNode,
      displayName: newName,
      variable: newName,
      project: false,
    }
    nNode.attribute = nAttribute;
    nNode.properties.push(Properties.ATTRIBUTE);
    nNode.found = true;
    // Project what we need to
    linkCollection.collection.project = true;
    coll.collection.project = true;
    let relationship = {type: RelationshipTypes.ONEHOP, nodes: [coll, attr], implicitNodes: [nNode]};
    nNode.relationships.push(relationship);
    linkCollection.relationships.push(relationship);
    return relationship;
  }
  /*
  // Not sure if this one works... using the entity table, a 2 hop link can
  // be found almost anywhere, yielding results like
  // e.g. "Pets heights" => pets -> snake -> entity -> corey -> height
   relationship = eve.query(``)
    .select("collection entities", { collection: coll.id }, "collection")
    .select("directionless links", { entity: ["collection", "entity"] }, "links")
    .select("directionless links", { entity: ["links", "link"] }, "links2")
   .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
    .exec();
  if (relationship.unprojected.length > 0) {
    return true;
  }*/
  log("  No relationship found");
  return {type: RelationshipTypes.NONE};
}

// Extracts entities from unprojected results
function extractFromUnprojected(coll, ix: number, size: number, field: string): Array<string> {
  let results: Array<string> = [];
  for (let i = 0, len = coll.length; i < len; i += size) {
    results.push(coll[i + ix][field]);
  }
  return results;
}

// Find collections that entities have in common
function findCommonCollections(entities: Array<string>): Array<string> {
  let intersection = entityTocollectionsArray(entities[0]);
  intersection.sort();
  for (let entId of entities.slice(1)) {
    let cur = entityTocollectionsArray(entId);
    cur.sort();
    arrayIntersect(intersection, cur);
  }
  intersection.sort((a, b) => {
    return eve.findOne("collection", { collection: a })["count"] - eve.findOne("collection", { collection: b })["count"];
  });
  return intersection;
}

function entityTocollectionsArray(entity: string): Array<string> {
  let entities = eve.find("collection entities", { entity });
  return entities.map((a) => a["collection"]);
}

function findCollection(node: Node, context: Context): boolean {
  let collection: Collection;
  collection = findEveCollection(node.name);
  if (collection !== undefined) {
    context.found.push(node);
    collection.node = node;
    node.collection = collection;
    node.representations.collection = collection;
    node.type = NodeTypes.COLLECTION;
    node.found = true;
    node.properties.push(Properties.COLLECTION);
    return true;
  }
  return false;
}

function findEntity(node: Node, context: Context): boolean {
  let entity: Entity;
  entity = findEveEntity(node.name);
  if (entity !== undefined) {
    context.found.push(node);
    entity.node = node;
    node.entity = entity;
    node.representations.entity = entity;
    node.type = NodeTypes.ENTITY;
    node.found = true;
    node.properties.push(Properties.ENTITY);
    return true;
  }
  return false;
}

function findAttribute(node: Node, context: Context): boolean {
  if (node.name === "is a") {
    return false;
  }
  let attribute: Attribute;
  attribute = findEveAttribute(node.name);
  if (attribute !== undefined) {
    context.found.push(node);
    attribute.node = node;
    node.attribute = attribute;
    node.representations.attribute = attribute;
    node.type = NodeTypes.ATTRIBUTE;
    node.found = true;
    node.properties.push(Properties.ATTRIBUTE);
    return true;
  }
  return false;
}

// ----------------------------------------------------------------------------
// Query functions
// ----------------------------------------------------------------------------

interface Field {
  name: string,
  value: string | number,
  variable: boolean,
}

interface Term {
  type: string,
  table?: string,
  fields: Array<Field>,
  node?: Node,
}

export interface Query {
  type: string,
  terms: Array<Term>,
  subqueries: Array<Query>,
  projects: Array<Term>,
  toString(number?: number): string;
}

function addFieldsToProject(projectFields: Array<Field>, fields: Array<Field>): void {
  let field
  for (field of fields) {
    let matchingFields = projectFields.filter((f) => f.name === field.name);
    if (matchingFields.length === 0) {
      projectFields.push(field);
    }
  }
}

function negateTerm(term: Term): Query {
  if (term.table === "entity eavs" && term.fields[2] !== undefined && term.fields[2].name === "value") {
    term.fields.splice(2,1);
  }
  let negate = newQuery([term]);
  negate.type = "negate";
  return negate;
}

export function newQuery(terms?: Array<Term>, subqueries?: Array<Query>, projects?: Array<Term>): Query {
  if (terms === undefined) {
    terms = [];
  }
  if (subqueries === undefined) {
    subqueries = [];
  }
  if (projects === undefined) {
    projects = [];
  }
  // Dedupe terms
  let termStrings = terms.map(termToString);
  let uniqueTerms: Array<boolean> = termStrings.map((value, index, self) => {
    return self.indexOf(value) === index;
  }); 
  terms = terms.filter((term, index) => uniqueTerms[index]);
  let query: Query = {
    type: "query",
    terms: terms,
    subqueries: subqueries,
    projects: projects,
    toString: queryToString,
  }
  function queryToString(depth?: number): string {
    if (query.terms.length === 0 && query.projects.length === 0) {
      return "";
    }
    if (depth === undefined) {
      depth = 0;
    }
    let indent = Array(depth+1).join("\t");
    let queryString = indent + "(";
    // Map each term/subquery/project to a string
    let typeString = query.type;
    let termString = query.terms.map((term) => termToString(term,depth+1)).join("\n");
    let subqueriesString = query.subqueries.map((query) => query.toString(depth + 1)).join("\n");
    let projectsString = query.projects.map((term) => termToString(term,depth+1)).join("\n");
    // Now compose the query string
    queryString += typeString;
    queryString += termString === "" ? "" : "\n" + termString;
    queryString += subqueriesString === "" ? "" : "\n" + subqueriesString;
    queryString += projectsString === "" ? "" : "\n" + projectsString;
    // Close out the query
    queryString += "\n" + indent + ")";
    return queryString;
  }
  function termToString(term: Term, depth?: number): string {
    if (depth === undefined) {
      depth = 0;
    }
    let indent = Array(depth+1).join("\t");
    let termString = indent + "(";
    termString += `${term.type} `;
    termString += `${term.table === undefined ? "" : `"${term.table}" `}`;
    termString += term.fields.map((field) => `:${field.name} ${field.variable ? field.value : `"${field.value}"`}`).join(" ");
    termString += ")";
    return termString;
  }
  return query;
}

function formQuery(node: Node): Query {
  let query: Query = newQuery();
  let projectFields: Array<Field> = [];
  
  //--------------------------
  // Handle the children nodes
  //--------------------------
  
  let childQueries = node.children.map(formQuery);
  // Subsume child queries
  let combinedProjectFields: Array<Field> = [];
  for (let cQuery of childQueries) {
    query.terms = query.terms.concat(cQuery.terms);
    query.subqueries = query.subqueries.concat(cQuery.subqueries);
    // Combine unnamed projects
    for (let project of cQuery.projects) {
      if (project.table === undefined) {
        addFieldsToProject(combinedProjectFields, project.fields);
      }
    }
  }
  if (combinedProjectFields.length > 0) {
    projectFields = combinedProjectFields;
  }
  // Sort terms
  query.terms = query.terms.sort((a,b) => {
    let aRank = setRank(a.table);
    let bRank = setRank(b.table);
    function setRank(table: string): number {
      if (table === "entity eavs") { return 1 }
      else if (table === "directionless links") { return 2 }
      else if (table === "is a attributes") { return 3 }
      else { return 4 }
    }
    return aRank - bRank;
  });
  
  //-------------------------
  // Handle the current node
  //-------------------------
  
  // Just return at the root
  if (node.hasProperty(Properties.ROOT) || node.hasProperty(Properties.ARGUMENT)) {
    if (projectFields.length > 0) {                        
      let project = {
        type: "project!",
        fields: projectFields,
      }
      query.projects.push(project);
    }
    return query;
  }
  // Handle functions -------------------------------
  if (node.hasProperty(Properties.FUNCTION) && 
      node.fxn.type === FunctionTypes.NEGATE) {
    log("Building negate term for: " + node.name); 
    let negatedTerm = query.terms.pop();
    let negatedQuery = negateTerm(negatedTerm);
    query.subqueries.push(negatedQuery);
    projectFields = [];
  }
  if (node.hasProperty(Properties.FUNCTION) && ( 
      node.fxn.type === FunctionTypes.AGGREGATE || 
      node.fxn.type === FunctionTypes.CALCULATE ||
      node.fxn.type === FunctionTypes.FILTER)) {
    // Collection all input and output nodes which were found
    let allArgsFound = node.children.every((child) => child.found);
        
    // If we have the right number of arguments, proceed
    let output;
    if (allArgsFound) {
      log("Building function term for: " + node.name);
      let args = node.children.filter((child) => child.hasProperty(Properties.ARGUMENT)).map((arg) => arg.children[0]);
      let fields: Array<Field> = args.map((arg,i) => {
        if (arg.parent.hasProperty(Properties.ROOT)) {
          return undefined;
        }
        return {name: node.fxn.fields[i].name, 
                value: arg.attribute.variable, 
                variable: arg.attribute.attributeVar !== undefined ? arg.attribute.attributeVar : true
               }; 
      }).filter((f) => f !== undefined);
      let term: Term = {
        type: "select",
        table: node.fxn.name,
        fields: fields,
        node: node,
      }
      query.terms.push(term);
      // project output if necessary
      if (node.fxn.project === true) {
        projectFields = args.filter((arg) => arg.parent.hasProperty(Properties.OUTPUT))
                            .map((arg) => {return {name: node.fxn.name, 
                                                   value: arg.attribute.variable, 
                                                   variable: true}});
        args.map((a) => {
          if (a.hasProperty(Properties.ATTRIBUTE)) {
            a.attribute.project = false;
            a.attribute.projectedAs = undefined;  
          } else if (a.hasProperty(Properties.COLLECTION)) {
            a.collection.project = false;
            a.collection.projectedAs = undefined;  
          }
        });
        query.projects = []; // Clears all previous projects
      }
    } 
  }
  if (node.hasProperty(Properties.FUNCTION) && ( 
      node.fxn.type === FunctionTypes.GROUP)) {
    let allArgsFound = node.children.every((child) => child.found);
    if (allArgsFound) {
      log("Building function term for: " + node.name);
      
      let groupNode = node.children[1].children[0];
      if (groupNode.hasProperty(Properties.COLLECTION)) {
        groupNode.collection.handled = false;  
      } else if (groupNode.hasProperty(Properties.ATTRIBUTE)) {
        groupNode.attribute.handled = false;  
      }
      
      let subquery = query;
      let query2 = formQuery(groupNode);
      query = newQuery();
      query.subqueries.push(subquery);
      query.terms = query.terms.concat(query2.terms); 
    }
  }
  // Handle attributes -------------------------------
  if (node.hasProperty(Properties.ATTRIBUTE) && !node.attribute.handled) {
    log("Building attribute term for: " + node.name);
    let fields: Array<Field> = [];
    let attr = node.attribute;
    if (attr.refs !== undefined) {
      for (let ref of attr.refs) {
        let entityVar = ref.entity !== undefined ? ref.entity.id : ref.collection.variable;
        let fieldVar = ref.entity !== undefined && ref.entity.entityAttr === false ? false : true;
        if (fields.length === 0) {
          let entityField = {
            name: "entity", 
            value: entityVar, 
            variable: fieldVar,
          };
          fields.push(entityField);
        }
        // Build a query for each ref and merge it with the current query
        let refQuery = formQuery(ref);
        query.terms = query.terms.concat(refQuery.terms);
        if (refQuery.projects.length > 0) {
          addFieldsToProject(projectFields, refQuery.projects[0].fields)
        }
      }      
    }             
    let attrField = {
      name: "attribute", 
      value: attr.id, 
      variable: false
    };
    fields.push(attrField);           
    let valueField = {
      name: "value", 
      value: attr.variable, 
      variable: attr.attributeVar !== undefined ? attr.attributeVar : true,
    };
    fields.push(valueField);            
    let term: Term = {
      type: "select",
      table: "entity eavs",
      fields: fields,
      node: node,
    }
    query.terms.push(term);
    // project if necessary
    if (node.attribute.project) {
      let projectAttribute = {
        name: attr.displayName.replace(/ /g,''), 
        value: attr.variable, 
        variable: true
      };
      attr.projectedAs = projectAttribute.name;
      addFieldsToProject(projectFields, [projectAttribute]);
    }
    node.attribute.handled = true;
  }
  // Handle collections -------------------------------
  if (node.hasProperty(Properties.COLLECTION) && !node.collection.handled) {
    log("Building collection term for: " + node.name);
    let collection = node.collection;
    let entityField = {
      name: "entity", 
      value: collection.variable, 
      variable: true
    };
    let collectionField = {
      name: "collection", 
      value: collection.id, 
      variable: false
    };
    let term: Term = {
      type: "select",
      table: "is a attributes",
      fields: [entityField, collectionField],
      node: node,
    }
    query.terms.push(term);
    // project if necessary
    if (node.collection.project) {
      let projectCollection = {
        name: collection.variable.replace(/ /g,''), 
        value: collection.variable, 
        variable: true
      };
      collection.projectedAs = projectCollection.name;
      addFieldsToProject(projectFields, [projectCollection]);
    }
    node.collection.handled = true;
  }
  // Handle entities -------------------------------
  if (node.hasProperty(Properties.ENTITY) && !node.entity.handled) {
    log("Building entity term for: " + node.name);
    let entity = node.entity;
    let fields = [];
    let entityField = {
      name: "entity", 
      value: entity.entityVar ? entity.variable : entity.id, 
      variable: entity.entityVar,
    };
    fields.push(entityField);

    if (entity.entityVar) {
      let valueField = {
        name: entity.entityVar ? "link" : "value", 
        value: entity.valueVar ? entity.value : entity.id, 
        variable: entity.valueVar,
      };
      fields.push(valueField);  
    }
    let term: Term = {
      type: "select",
      table: entity.entityVar ? "directionless links" : "entity eavs",
      fields: fields,
      node: node,
    }
    query.terms.push(term);
    // project if necessary
    if (entity.project === true) {
      let projectEntity = {
        name: entity.displayName.replace(/ /g,''),
        value: entity.id, 
        variable: false
      };
      entity.projectedAs = projectEntity.name;
      addFieldsToProject(projectFields, [projectEntity]);
    }
    node.entity.handled = true;
  }
  // Project something if necessary       
  if (projectFields.length > 0) {                        
    let project = {
      type: "project!",
      fields: projectFields,
    }
    query.projects.push(project);
  }
  return query;
}

// ----------------------------------------------------------------------------
// Debug utility functions
// ---------------------------------------------------------------------------- 
let divider = "--------------------------------------------------------------------------------";

export let debug = false;

function log(x: any) {
  if (debug) {
    console.log(x);
  }
}

function tokenToString(token: Token, s1?: number, s2?: number, s3?: number, s4?: number, s5?: number): string {
  let properties = `(${token.properties.map((property: Properties) => Properties[property]).join("|")})`;
  properties = properties.length === 2 ? "" : properties;
  let tokenSpan = token.start === undefined ? " " : ` [${token.start}-${token.end}] `;
  let spacer1 = Array(s1-`${token.ix}`.length + 1).join(" ");
  let spacer2 = Array(s2-`${token.originalWord}`.length + 1).join(" ");
  let spacer3 = Array(s3-`${token.normalizedWord}`.length + 1).join(" ");
  let spacer4 = Array(s4 - `${MajorPartsOfSpeech[getMajorPOS(token.POS)]}`.length + 1).join(" ");
  let spacer5 = Array(s5 - `${MinorPartsOfSpeech[token.POS]}`.length + 1).join(" ");
  let tokenString = `${token.ix}:${spacer1} ${token.originalWord}${spacer2} | ${token.normalizedWord}${spacer3} | ${MajorPartsOfSpeech[getMajorPOS(token.POS)]}${spacer4} | ${MinorPartsOfSpeech[token.POS]}${spacer5} | ${properties}` ;
  return tokenString;
}

export function tokenArrayToString(tokens: Array<Token>): string {
  let s1: number = `${tokens[tokens.length-1].ix}`.length; 
  let s2: number = tokens.map((token) => token.originalWord.length).reduce((a,b) => {
    if (b > a) { return b; } else { return a; }
  });
  let s3: number = tokens.map((token) => token.normalizedWord.length).reduce((a,b) => {
    if (b > a) { return b; } else { return a; } 
  });
  let s4: number = tokens.map((token) => `${MajorPartsOfSpeech[getMajorPOS(token.POS)]}`.length).reduce((a,b) => {
    if (b > a) { return b; } else { return a; } 
  });
  let s5: number = tokens.map((token) => `${MinorPartsOfSpeech[token.POS]}`.length).reduce((a,b) => {
    if (b > a) { return b; } else { return a; } 
  });
  let tokenArrayString = tokens.map((token) => tokenToString(token,s1,s2,s3,s4,s5)).join("\n");
  return divider + "\n" + tokenArrayString + "\n" + divider;
}

// ----------------------------------------------------------------------------
// Utility functions
// ----------------------------------------------------------------------------

function flattenNestedArray(nestedArray: Array<Array<any>>): Array<any> {
  let flattened: Array<any> = [].concat.apply([],nestedArray);
  return flattened;
}

function onlyUnique(value, index, self) { 
  return self.indexOf(value) === index;
}

function arrayIntersect(a, b) {
  let ai = 0;
  let bi = 0;
  let result = [];
  while (ai < a.length && bi < b.length) {
    if (a[ai] < b[bi]) ai++;
    else if (a[ai] > b[bi]) bi++;
    else {
      result.push(a[ai]);
      ai++;
      bi++;
    }
  }
  return result;
}

function isNumeric(n: any): boolean {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

function allFound(node: Node): boolean {
  let cFound = node.children.map(allFound).every((c)=>c);
  if (cFound && node.found) {
    return true;
  } else {
    return false;
  }
} 
// ----------------------------------------------------------------------------

declare var exports;
window["NLQP"] = exports;
