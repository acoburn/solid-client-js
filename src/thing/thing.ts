/**
 * Copyright 2020 Inrupt Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
 * Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { NamedNode, Quad, Quad_Object } from "rdf-js";
import { dataset, filter, clone, internal_isDatasetCore } from "../rdfjs";
import {
  isLocalNode,
  isEqual,
  isNamedNode,
  getLocalNode,
  asNamedNode,
  resolveLocalIri,
  isLiteral,
  xmlSchemaTypes,
  deserializeBoolean,
  deserializeDatetime,
  deserializeDecimal,
  deserializeInteger,
} from "../datatypes";
import {
  SolidDataset,
  UrlString,
  Thing,
  Url,
  ThingLocal,
  LocalNode,
  ThingPersisted,
  WithChangeLog,
  hasChangelog,
  hasResourceInfo,
} from "../interfaces";
import { getSourceUrl, internal_cloneResource } from "../resource/resource";
import { getTermAll } from "./get";

/**
 * @hidden Scopes are not yet consistently used in Solid and hence not properly implemented in this library yet (the add*() and set*() functions do not respect it yet), so we're not exposing these to developers at this point in time.
 */
export interface GetThingOptions {
  /**
   * Which Named Graph to extract the Thing from.
   *
   * If not specified, the Thing will include Quads from all Named Graphs in the given
   * [[SolidDataset]].
   **/
  scope?: Url | UrlString;
}
export function getThing(
  solidDataset: SolidDataset,
  thingUrl: UrlString | Url,
  options?: GetThingOptions
): ThingPersisted | null;
export function getThing(
  solidDataset: SolidDataset,
  thingUrl: LocalNode,
  options?: GetThingOptions
): ThingLocal | null;
export function getThing(
  solidDataset: SolidDataset,
  thingUrl: UrlString | Url | LocalNode,
  options?: GetThingOptions
): Thing | null;
/**
 * Extract Quads with a given Subject from a [[SolidDataset]] into a [[Thing]].
 *
 * @param solidDataset The [[SolidDataset]] to extract the [[Thing]] from.
 * @param thingUrl The URL of the desired [[Thing]].
 * @param options Not yet implemented.
 */
export function getThing(
  solidDataset: SolidDataset,
  thingUrl: UrlString | Url | LocalNode,
  options: GetThingOptions = {}
): Thing | null {
  const subject = isLocalNode(thingUrl) ? thingUrl : asNamedNode(thingUrl);
  const scope: NamedNode | null = options.scope
    ? asNamedNode(options.scope)
    : null;

  const thingDataset = solidDataset.match(subject, null, null, scope);
  if (thingDataset.size === 0) {
    return null;
  }

  if (isLocalNode(subject)) {
    const thing: ThingLocal = Object.assign(thingDataset, {
      internal_localSubject: subject,
    });

    return thing;
  } else {
    const thing: Thing = Object.assign(thingDataset, {
      internal_url: subject.value,
    });

    return thing;
  }
}

/**
 * Get all [[Thing]]s about which a [[SolidDataset]] contains Quads.
 *
 * @param solidDataset The [[SolidDataset]] to extract the [[Thing]]s from.
 * @param options Not yet implemented.
 */
export function getThingAll(
  solidDataset: SolidDataset,
  options: GetThingOptions = {}
): Thing[] {
  const subjectNodes = new Array<Url | LocalNode>();
  for (const quad of solidDataset) {
    // Because NamedNode objects with the same IRI are actually different
    // object instances, we have to manually check whether `subjectNodes` does
    // not yet include `quadSubject` before adding it.
    const quadSubject = quad.subject;
    if (
      isNamedNode(quadSubject) &&
      !subjectNodes.some((subjectNode) => isEqual(subjectNode, quadSubject))
    ) {
      subjectNodes.push(quadSubject);
    }
    if (
      isLocalNode(quadSubject) &&
      !subjectNodes.some((subjectNode) => isEqual(subjectNode, quadSubject))
    ) {
      subjectNodes.push(quadSubject);
    }
  }

  const things: Thing[] = subjectNodes.map(
    (subjectNode) => getThing(solidDataset, subjectNode, options)
    // We can make the type assertion here because `getThing` only returns `null` if no data with
    // the given subject node can be found, and in this case the subject node was extracted from
    // existing data (i.e. that can be found by definition):
  ) as Thing[];

  return things;
}

/**
 * Insert a [[Thing]] into a [[SolidDataset]], replacing previous instances of that Thing.
 *
 * @param solidDataset The SolidDataset to insert a Thing into.
 * @param thing The Thing to insert into the given SolidDataset.
 * @returns A new SolidDataset equal to the given SolidDataset, but with the given Thing.
 */
export function setThing<Dataset extends SolidDataset>(
  solidDataset: Dataset,
  thing: Thing
): Dataset & WithChangeLog {
  const newDataset = removeThing(solidDataset, thing);
  newDataset.internal_changeLog = {
    additions: [...newDataset.internal_changeLog.additions],
    deletions: [...newDataset.internal_changeLog.deletions],
  };

  for (const quad of thing) {
    newDataset.add(quad);
    if (newDataset.internal_changeLog.deletions.includes(quad)) {
      newDataset.internal_changeLog.deletions = newDataset.internal_changeLog.deletions.filter(
        (deletion) => deletion !== quad
      );
    } else {
      newDataset.internal_changeLog.additions.push(quad);
    }
  }

  return newDataset;
}

/**
 * Remove a Thing from a SolidDataset.
 *
 * @param solidDataset The SolidDataset to remove a Thing from.
 * @param thing The Thing to remove from `solidDataset`.
 * @returns A new [[SolidDataset]] equal to the input SolidDataset, excluding the given Thing.
 */
export function removeThing<Dataset extends SolidDataset>(
  solidDataset: Dataset,
  thing: UrlString | Url | LocalNode | Thing
): Dataset & WithChangeLog {
  const newSolidDataset = withChangeLog(internal_cloneResource(solidDataset));
  newSolidDataset.internal_changeLog = {
    additions: [...newSolidDataset.internal_changeLog.additions],
    deletions: [...newSolidDataset.internal_changeLog.deletions],
  };
  const resourceIri: UrlString | undefined = hasResourceInfo(newSolidDataset)
    ? getSourceUrl(newSolidDataset)
    : undefined;

  const thingSubject = internal_toNode(thing);
  const existingQuads = Array.from(newSolidDataset);
  existingQuads.forEach((quad) => {
    if (!isNamedNode(quad.subject) && !isLocalNode(quad.subject)) {
      // This data is unexpected, and hence unlikely to be added by us. Thus, leave it intact:
      return;
    }
    if (isEqual(thingSubject, quad.subject, { resourceIri: resourceIri })) {
      newSolidDataset.delete(quad);
      if (newSolidDataset.internal_changeLog.additions.includes(quad)) {
        newSolidDataset.internal_changeLog.additions = newSolidDataset.internal_changeLog.additions.filter(
          (addition) => addition !== quad
        );
      } else {
        newSolidDataset.internal_changeLog.deletions.push(quad);
      }
    }
  });
  return newSolidDataset;
}

function withChangeLog<Dataset extends SolidDataset>(
  solidDataset: Dataset
): Dataset & WithChangeLog {
  const newSolidDataset: Dataset & WithChangeLog = hasChangelog(solidDataset)
    ? solidDataset
    : Object.assign(internal_cloneResource(solidDataset), {
        internal_changeLog: { additions: [], deletions: [] },
      });
  return newSolidDataset;
}

/** Pass these options to [[createThing]] to initialise a new [[Thing]] whose URL will be determined when it is saved. */
export type CreateThingLocalOptions = {
  /**
   * The name that should be used for this [[Thing]] when constructing its URL.
   *
   * If not provided, a random one will be generated.
   */
  name?: string;
};
/** Pass these options to [[createThing]] to initialise a new [[Thing]] whose URL is already known. */
export type CreateThingPersistedOptions = {
  /**
   * The URL of the newly created [[Thing]].
   */
  url: UrlString;
};
/** The options you pass to [[createThing]].
 * - To specify the URL for the initialised Thing, pass [[CreateThingPersistedOptions]].
 * - To have the URL determined during the save, pass [[CreateThingLocalOptions]].
 */
export type CreateThingOptions =
  | CreateThingLocalOptions
  | CreateThingPersistedOptions;
/**
 * Initialise a new [[Thing]] in memory with a given URL.
 *
 * @param options See [[CreateThingPersistedOptions]] for how to specify the new [[Thing]]'s URL.
 */
export function createThing(
  options: CreateThingPersistedOptions
): ThingPersisted;
/**
 * Initialise a new [[Thing]] in memory.
 *
 * @param options Optional parameters that affect the final URL of this [[Thing]] when saved.
 */
export function createThing(options?: CreateThingLocalOptions): ThingLocal;
export function createThing(options?: CreateThingOptions): Thing;
export function createThing(options: CreateThingOptions = {}): Thing {
  if (typeof (options as CreateThingPersistedOptions).url !== "undefined") {
    const url = (options as CreateThingPersistedOptions).url;
    /* istanbul ignore else [URL is defined is the testing environment, so we cannot test this] */
    if (typeof URL !== "undefined") {
      // Throws an error if the IRI is invalid:
      new URL(url);
    }
    const thing: ThingPersisted = Object.assign(dataset(), {
      internal_url: url,
    });
    return thing;
  }
  const name = (options as CreateThingLocalOptions).name ?? generateName();
  const localSubject: LocalNode = getLocalNode(name);
  const thing: ThingLocal = Object.assign(dataset(), {
    internal_localSubject: localSubject,
  });
  return thing;
}

/**
 * @param input An value that might be a [[Thing]].
 * @returns Whether `input` is a Thing.
 * @since 0.2.0
 */
export function isThing<X>(input: X | Thing): input is Thing {
  return (
    internal_isDatasetCore(input) &&
    (isThingLocal(input as ThingLocal) ||
      typeof (input as ThingPersisted).internal_url === "string")
  );
}

/**
 * Get the URL to a given [[Thing]].
 *
 * @param thing The [[Thing]] you want to obtain the URL from.
 * @param baseUrl If `thing` is not persisted yet, the base URL that should be used to construct this [[Thing]]'s URL.
 */
export function asUrl(thing: ThingLocal, baseUrl: UrlString): UrlString;
export function asUrl(thing: ThingPersisted): UrlString;
export function asUrl(thing: Thing, baseUrl: UrlString): UrlString;
export function asUrl(thing: Thing, baseUrl?: UrlString): UrlString {
  if (isThingLocal(thing)) {
    if (typeof baseUrl === "undefined") {
      throw new Error(
        "The URL of a Thing that has not been persisted cannot be determined without a base URL."
      );
    }
    return resolveLocalIri(thing.internal_localSubject.internal_name, baseUrl);
  }

  return thing.internal_url;
}
/** @hidden Alias of [[asUrl]] for those who prefer IRI terminology. */
export const asIri = asUrl;

/**
 * Gets a human-readable representation of the given Thing to aid debugging.
 *
 * Note that changes to the exact format of the return value are not considered a breaking change;
 * it is intended to aid in debugging, not as a serialisation method that can be reliably parsed.
 *
 * @param thing The Thing to get a human-readable representation of.
 * @since 0.3.0
 */
export function thingAsMarkdown(thing: Thing): string {
  let thingAsMarkdown: string = "";

  if (isThingLocal(thing)) {
    thingAsMarkdown += `## Thing (no URL yet — identifier: \`#${thing.internal_localSubject.internal_name}\`)\n`;
  } else {
    thingAsMarkdown += `## Thing: ${thing.internal_url}\n`;
  }

  const quads = Array.from(thing);
  if (quads.length === 0) {
    thingAsMarkdown += "\n<empty>\n";
  } else {
    const predicates = new Set(quads.map((quad) => quad.predicate.value));
    for (const predicate of predicates) {
      thingAsMarkdown += `\nProperty: ${predicate}\n`;
      const values = getTermAll(thing, predicate);
      values.forEach((value) => {
        thingAsMarkdown += `- ${internal_getReadableValue(value)}\n`;
      });
    }
  }

  return thingAsMarkdown;
}

/** @hidden For internal use only. */
export function internal_getReadableValue(value: Quad_Object): string {
  if (isNamedNode(value)) {
    return `<${value.value}> (URL)`;
  }
  if (isLiteral(value)) {
    if (!isNamedNode(value.datatype)) {
      return `[${value.value}] (RDF/JS Literal of unknown type)`;
    }
    let val;
    switch (value.datatype.value) {
      case xmlSchemaTypes.boolean:
        val =
          deserializeBoolean(value.value)?.valueOf() ??
          `Invalid data: \`${value.value}\``;
        return val + " (boolean)";
      case xmlSchemaTypes.dateTime:
        val =
          deserializeDatetime(value.value)?.toUTCString() ??
          `Invalid data: \`${value.value}\``;
        return val + " (datetime)";
      case xmlSchemaTypes.decimal:
        val =
          deserializeDecimal(value.value)?.toString() ??
          `Invalid data: \`${value.value}\``;
        return val + " (decimal)";
      case xmlSchemaTypes.integer:
        val =
          deserializeInteger(value.value)?.toString() ??
          `Invalid data: \`${value.value}\``;
        return val + " (integer)";
      case xmlSchemaTypes.langString:
        return `"${value.value}" (${value.language} string)`;
      case xmlSchemaTypes.string:
        return `"${value.value}" (string)`;
      default:
        return `[${value.value}] (RDF/JS Literal of type: \`${value.datatype.value}\`)`;
    }
  }
  if (isLocalNode(value)) {
    return `<#${value.internal_name}> (URL)`;
  }
  if (value.termType === "BlankNode") {
    return `[${value.value}] (RDF/JS BlankNode)`;
  }
  if (value.termType === "Quad") {
    return `??? (nested RDF* Quad)`;
  }
  /* istanbul ignore else: The if statements are exhaustive; if not, TypeScript will complain. */
  if (value.termType === "Variable") {
    return `?${value.value} (RDF/JS Variable)`;
  }
  /* istanbul ignore next: The if statements are exhaustive; if not, TypeScript will complain. */
  return value;
}

/**
 * @param thing The [[Thing]] of which a URL might or might not be known.
 * @return Whether `thing` has no known URL yet.
 */
export function isThingLocal(
  thing: ThingPersisted | ThingLocal
): thing is ThingLocal {
  return (
    typeof (thing as ThingLocal).internal_localSubject?.internal_name ===
      "string" && typeof (thing as ThingPersisted).internal_url === "undefined"
  );
}
/**
 * @hidden
 * @param thing The Thing whose Subject Node you're interested in.
 * @returns A Node that can be used as the Subject for this Thing's Quads.
 */
export function internal_toNode(
  thing: UrlString | Url | ThingPersisted
): NamedNode;
export function internal_toNode(thing: LocalNode | ThingLocal): LocalNode;
export function internal_toNode(
  thing: UrlString | Url | LocalNode | Thing
): NamedNode | LocalNode;
export function internal_toNode(
  thing: UrlString | Url | LocalNode | Thing
): NamedNode | LocalNode {
  if (isNamedNode(thing) || isLocalNode(thing)) {
    return thing;
  }
  if (typeof thing === "string") {
    return asNamedNode(thing);
  }
  if (isThingLocal(thing)) {
    return thing.internal_localSubject;
  }
  return asNamedNode(asUrl(thing));
}

/**
 * @internal
 * @param thing Thing to clone.
 * @returns A new Thing with the same Quads as `input`.
 */
export function cloneThing<T extends Thing>(thing: T): T {
  const cloned = clone(thing);
  if (isThingLocal(thing)) {
    (cloned as ThingLocal).internal_localSubject = thing.internal_localSubject;
    return cloned as T;
  }
  (cloned as ThingPersisted).internal_url = (thing as ThingPersisted).internal_url;
  return cloned as T;
}

/**
 * @internal
 * @param thing Thing to clone.
 * @param callback Function that takes a Quad, and returns a boolean indicating whether that Quad should be included in the cloned Dataset.
 * @returns A new Thing with the same Quads as `input`, excluding the ones for which `callback` returned `false`.
 */
export function filterThing<T extends Thing>(
  thing: T,
  callback: (quad: Quad) => boolean
): T {
  const filtered = filter(thing, callback);
  if (isThingLocal(thing)) {
    (filtered as ThingLocal).internal_localSubject =
      thing.internal_localSubject;
    return filtered as T;
  }
  (filtered as ThingPersisted).internal_url = (thing as ThingPersisted).internal_url;
  return filtered as T;
}

/**
 * Generate a string that can be used as the unique identifier for a Thing
 *
 * This function works by starting with a date string (so that Things can be
 * sorted chronologically), followed by a random number generated by taking a
 * random number between 0 and 1, and cutting off the `0.`.
 *
 * @internal
 * @returns An string that's likely to be unique
 */
const generateName = () => {
  return (
    Date.now().toString() + Math.random().toString().substring("0.".length)
  );
};
