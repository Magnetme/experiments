import angular from 'angular';
import ngAsync from 'ng-async';

function memoize(func) {
	const cache = new Map();
	return function(...args) {
		if (!cache.has(args[0])) {
			cache.set(args[0], func(...args));
		}
		return cache.get(args[0]);
	}
}

export default angular.module("mm.experiments", [ ngAsync.name ])
	.factory('experiments', ($q) => {
		'ngInject';

		const variations = new Map();
		return {
			/**
			 * Sets a variation for a certain experiment.
			 */
			setVariation(name, variation) {
				variations.set(name, () => $q.resolve(variation));
			},
			/**
			 * Registers a promise for a certain variation.
			 */
			setDeferredVariation(name, deferred) {
				variations.set(name, () => deferred);
			},
			/**
			 * Registers a factory for getting the variation of an experiment.
			 * This is intended to be able to lazily initialize experiments.
			 */
			setVariationFactory(name, variationFactory) {
				variations.set(name, memoize(variationFactory));
			},
			/**
			 * Returns a promise that resolves to a variation
			 */
			getVariation(name) {
				if (!variations.has(name)) {
					console.warn(`Experiment ${name} is not loaded`);
					return $q.reject(`Experiment ${name} is not loaded`);
				}
				return variations.get(name)();
			}
		};
	})
	.factory('googleExperiments', ($q, $rootScope, $timeout, $async) => {
		'ngInject';
		const experiments = new Map();
		const resolvers = new Map();
		const promises = new Map();

		/**
		 * Loads the experiments api and resolves to the cxApi object.
		 */
		const getCxApi = $async(function*() {
			yield new Promise((resolve, reject) => {
				if (window.cxApi) {
					resolve();
					return;
				}
				const script = document.createElement('script');
				script.src = 'https://www.google-analytics.com/cx/api.js';
				script.addEventListener('load', () => {
					resolve();
				});
				script.addEventListener('error', () => {
					reject(new Error("Could not load Google Analytics API, likely due to an ad blocker"));
				});
				document.body.appendChild(script);
			});
			return window.cxApi;
		});

		/**
		 * Makes sure the variation is completely loaded in the current document.
		 *
		 * When the experiment is loaded in an iframe the cookies are not (always?) directly visible
		 * from the main document. Therefore any call to analytics from the main document will NOT
		 * include the variation. To make sure the variation is loaded we explicitely ask the cxApi
		 * for the variation. As a side effect it will load the variation into the context of the
		 * current document, and hence all following analytics calls will contain the experiment
		 * parameters.
		 */
		const loadVariationInDocument = $async(function*(id) {
			try {
				const cxApi = yield getCxApi();
				//because addblockers
				if (typeof cxApi !== 'undefined') {
					cxApi.getChosenVariation(id);
				}
			} catch (e) {
				//Could not load the api, likely due to an ad blocker.
				//Not much we can do about it
			}
		});

		window.mmGoogleExperimentCallback = $async(function*(id, variation) {
			//We cache the result as well as resolve the promise for the original call
			experiments.set(id, variation);
			yield loadVariationInDocument(id);
			if (resolvers.has(id)) {
				resolvers.get(id)(variation);
				resolvers.delete(id);
			}
		});;

		return {
			getVariation: $async(function*(id, defaultVariation = 0) {
				//Short circuit from cache if possible
				if (experiments.has(id)) {
					return experiments.get(id);
				}
				//Short circuit from promise cache if possible.
				//This is to prevent multiple iframes from being inserted when the first one hasn't finished
				//loading yet
				if (promises.has(id)) {
					return yield promises.get(id);
				}

				//If we don't have the id yet we create a new invisible iframe that can get the variation for a given
				//experiment. We need this iframe because the api doesn't allow us to choose the variation
				//for a given id, we can only do so for the id specified in the query parameter.
				//It uses the global mmGoogleExperimentCallback callback to return the experiment back to the application
				const promise = $q((resolve, reject) => {
					resolvers.set(id, resolve);
					const baseUrl = 'https://www.google-analytics.com/cx/api.js?experiment=';
					const content = `
						<body>
							<div>BaseUrl: ${baseUrl}
							id: ${id}</div>
							<script src="${baseUrl}${id}"></script>
							<script>
								var variation;
								//because ad-blockers
								if (typeof cxApi !== "undefined") {
									variation = cxApi.chooseVariation();
								} else {
									variation = ${defaultVariation};
								}
								// Some ad-blockers don't nuke the cxApi, but instead replace it with a
								// mock implementation. We also need to deal with that.
								// E.g. ghostery has this behaviour.
								if (typeof variation === 'undefined') {
									variation = ${defaultVariation};
								}
								window.parent.mmGoogleExperimentCallback("${id}", variation);
							</script>
						</body>
					`;
					const variationFrame = document.createElement('iframe');
					document.body.appendChild(variationFrame);
					variationFrame.style.display = 'none';
					const variationDocument = variationFrame.contentWindow.document;
					variationDocument.open();
					variationDocument.write(content);
					variationDocument.close();
				});
				promises.set(id, promise);
				return yield promise;
			})
		};
	})
	.directive('mmExperiment', (experiments, $async) => {
		'ngInject';
		return {
			restrict : 'A',
			require : 'mmExperiment',
			controller($q) {
				'ngInject';
				let resolveExperiment;
				/**
				 * Promise that resolves to the experiment.
				 *
				 * We need to do this with a promise since we can only resolve the experiment in the link
				 * function, which runs later than this and later than the child directives (e.g. mm-variation)
				 */
				this.experiment = $q(resolve => {
					resolveExperiment = resolve;
				});
				/**
				 * Internal method to set the experiment name from the link function
				 */
				this._setExperiment = (experiment) => {
					resolveExperiment(experiment);
				};
				/**
				 * Returns a promise that resolves to the variation chosen
				 */
				this.getVariation = $async(function*() {
					try {
						const experiment = yield this.experiment;
						return yield experiments.getVariation(experiment);
					} catch (e) {
						return 0;
					}
				});
			},
			link : $async(function*(scope, el, attrs, ctrl) {
				ctrl._setExperiment(attrs.mmExperiment);
				try {
					scope.$variation = yield experiments.getVariation(attrs.mmExperiment);
				} catch (e) {
					scope.$variation = 0;
					throw e;
				}
			})
		}
	})
	.directive('mmVariation', ($async) => {
		'ngInject';
		return {
			restrict : 'A',
			require : '^mmExperiment',
			transclude : 'element',
			priority: 599, //1 less than ng-if
			terminal : true,
			link: $async(function*(scope, el, attrs, experimentCtrl, $transclude) {
				let myVariation = attrs.mmVariation;
				const chosen = yield experimentCtrl.getVariation();
				//If the chosen variation is a number then we convert the given variation to a number too.
				//We always get it as a string, so we need to do this extra step.
				if (Number.isFinite(chosen)) {
					myVariation = Number(myVariation);
				}
				//If we're the chosen one then we can replace the comment placeholder with the actual content
				if (myVariation === chosen) {
					$transclude(clone => {
						el.replaceWith(clone);
					});
				}
			})
		}
	});

